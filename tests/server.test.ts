/**
 * MCP Server integration tests
 *
 * Uses the MCP SDK's Client + StdioClientTransport to spawn
 * the server as a child process and communicate over JSON-RPC.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import path from 'path';

describe('MCP Server Protocol', () => {
    let client: Client;
    let transport: StdioClientTransport;

    beforeAll(async () => {
        // Ensure database is populated first
        const scrapeResult = await new Promise<number>((resolve) => {
            const scrape = spawn('npx', ['tsx', 'src/scrapers/scrape-modules.ts'], {
                cwd: path.resolve('.'),
                shell: true,
                stdio: 'pipe',
            });
            scrape.on('close', (code) => resolve(code || 0));
        });
        expect(scrapeResult).toBe(0);

        // Create client transport that spawns the server
        transport = new StdioClientTransport({
            command: 'npx',
            args: ['tsx', 'src/mcp/server.ts'],
            cwd: path.resolve('.'),
            env: {
                ...process.env as Record<string, string>,
                LOG_LEVEL: 'error',
            },
            stderr: 'pipe',
        });

        client = new Client({
            name: 'test-client',
            version: '1.0.0',
        });

        await client.connect(transport);
    }, 60000);

    afterAll(async () => {
        try {
            await client.close();
        } catch {
            // Ignore cleanup errors
        }
    });

    // ── Capabilities ──

    it('should report tools capability', () => {
        const caps = client.getServerCapabilities();
        expect(caps?.tools).toBeDefined();
    });

    it('should report prompts capability', () => {
        const caps = client.getServerCapabilities();
        expect(caps?.prompts).toBeDefined();
    });

    it('should report resources capability', () => {
        const caps = client.getServerCapabilities();
        expect(caps?.resources).toBeDefined();
    });

    // ── Tools ──

    it('should list all tools', async () => {
        const result = await client.listTools();
        const toolNames = result.tools.map(t => t.name);

        expect(toolNames).toContain('tools_documentation');
        expect(toolNames).toContain('search_modules');
        expect(toolNames).toContain('get_module');
        expect(toolNames).toContain('check_account_compatibility');
        expect(toolNames).toContain('validate_scenario');
        expect(toolNames).toContain('create_scenario');
        expect(toolNames).toContain('search_templates');
        expect(toolNames).toContain('list_apps');
        expect(result.tools.length).toBe(8);
    });

    it('should call tools_documentation', async () => {
        const result = await client.callTool({
            name: 'tools_documentation',
            arguments: {},
        });

        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        const text = (result.content as any[])[0].text;
        const doc = JSON.parse(text);
        expect(doc.server.name).toBe('make-mcp-server');
        expect(doc.tools).toBeDefined();
        expect(doc.quickStart).toBeDefined();
        expect(doc.blueprintFormat).toBeDefined();
    });

    it('should search modules', async () => {
        const result = await client.callTool({
            name: 'search_modules',
            arguments: { query: 'slack' },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.count).toBeGreaterThan(0);
        expect(data.modules[0].app).toBe('Slack');
    });

    it('should search modules with app filter', async () => {
        const result = await client.callTool({
            name: 'search_modules',
            arguments: { query: '*', app: 'Google Sheets' },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.count).toBeGreaterThan(0);
        expect(data.modules.every((m: any) => m.app === 'Google Sheets')).toBe(true);
    });

    it('should get module details', async () => {
        const result = await client.callTool({
            name: 'get_module',
            arguments: { moduleId: 'slack:ActionPostMessage' },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.id).toBe('slack:ActionPostMessage');
        expect(data.name).toBeDefined();
        expect(data.parameters).toBeDefined();
        expect(Array.isArray(data.parameters)).toBe(true);
    });

    it('should return isError for unknown module', async () => {
        const result = await client.callTool({
            name: 'get_module',
            arguments: { moduleId: 'nonexistent:Module' },
        });

        expect(result.isError).toBe(true);
        expect((result.content as any[])[0].text).toContain('Module not found');
    });

    it('should check account compatibility for module ids', async () => {
        const result = await client.callTool({
            name: 'check_account_compatibility',
            arguments: { moduleIds: ['gateway:CustomWebHook'] },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.checkedModules || data.modules).toBeDefined();
    });

    it('should validate a correct blueprint', async () => {
        const blueprint = JSON.stringify({
            flow: [
                { id: 1, module: 'gateway:CustomWebHook', parameters: { name: 'Test' } },
                { id: 2, module: 'slack:ActionPostMessage', parameters: { channel: '#test', text: 'Hello' } },
            ],
        });

        const result = await client.callTool({
            name: 'validate_scenario',
            arguments: { blueprint },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.valid).toBe(true);
        expect(data.errors).toEqual([]);
        expect(data.modulesValidated.length).toBe(2);
        expect(data.accountCompatibility).toBeDefined();
        expect(Array.isArray(data.accountCompatibility.incompatibleModules)).toBe(true);
    });

    it('should detect unknown modules in blueprint', async () => {
        const blueprint = JSON.stringify({
            flow: [
                { id: 1, module: 'nonexistent:Module' },
            ],
        });

        const result = await client.callTool({
            name: 'validate_scenario',
            arguments: { blueprint },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors.length).toBeGreaterThan(0);
        expect(data.errors[0]).toContain('Unknown module');
    });

    it('should detect missing required parameters', async () => {
        const blueprint = JSON.stringify({
            flow: [
                { id: 1, module: 'gateway:CustomWebHook', parameters: {} },
            ],
        });

        const result = await client.callTool({
            name: 'validate_scenario',
            arguments: { blueprint },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors.some((e: string) => e.includes('Missing required parameter'))).toBe(true);
    });

    it('should warn when module version is pinned in blueprint', async () => {
        const blueprint = JSON.stringify({
            flow: [
                { id: 1, module: 'gateway:CustomWebHook', version: 2, parameters: { name: 'Test' } },
            ],
        });

        const result = await client.callTool({
            name: 'validate_scenario',
            arguments: { blueprint },
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(Array.isArray(data.warnings)).toBe(true);
        // Verified module with wrong version gets a specific warning about the verified version
        expect(data.warnings.some((w: string) => w.includes('verified working version') || w.includes('version'))).toBe(true);
    });

    it('should return isError for invalid JSON in blueprint', async () => {
        const result = await client.callTool({
            name: 'validate_scenario',
            arguments: { blueprint: 'not valid json{{{' },
        });

        expect(result.isError).toBe(true);
        expect((result.content as any[])[0].text).toContain('Invalid JSON');
    });

    it('should return isError for create_scenario without valid config', async () => {
        const result = await client.callTool({
            name: 'create_scenario',
            arguments: {
                name: 'Test Scenario',
                blueprint: JSON.stringify({ flow: [] }),
            },
        });

        expect(result.isError).toBe(true);
        // Error could be about API key or team ID depending on .env state
        const text = (result.content as any[])[0].text;
        expect(text.length).toBeGreaterThan(0);
    });

    it('should list apps', async () => {
        const result = await client.callTool({
            name: 'list_apps',
            arguments: {},
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.totalApps).toBeGreaterThan(0);
        expect(data.totalModules).toBeGreaterThan(0);
        expect(data.apps.length).toBeGreaterThan(0);
        expect(data.apps[0].app).toBeDefined();
        expect(data.apps[0].moduleCount).toBeGreaterThan(0);
    });

    it('should search templates', async () => {
        const result = await client.callTool({
            name: 'search_templates',
            arguments: {},
        });

        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.count).toBeDefined();
        expect(Array.isArray(data.templates)).toBe(true);
    });

    // ── Prompts ──

    it('should list prompts', async () => {
        const result = await client.listPrompts();
        const promptNames = result.prompts.map(p => p.name);

        expect(promptNames).toContain('build_scenario');
        expect(promptNames).toContain('explain_module');
    });

    it('should get build_scenario prompt', async () => {
        const result = await client.getPrompt({
            name: 'build_scenario',
            arguments: {
                description: 'Watch a Slack channel and log messages to Google Sheets',
            },
        });

        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.messages[0].role).toBe('user');
        const text = (result.messages[0].content as any).text;
        expect(text).toContain('Watch a Slack channel');
        expect(text).toContain('search_modules');
    });

    it('should get explain_module prompt', async () => {
        const result = await client.getPrompt({
            name: 'explain_module',
            arguments: { moduleId: 'slack:ActionPostMessage' },
        });

        expect(result.messages.length).toBeGreaterThan(0);
        const text = (result.messages[0].content as any).text;
        expect(text).toContain('slack:ActionPostMessage');
        expect(text).toContain('get_module');
    });

    // ── Resources ──

    it('should list resources', async () => {
        const result = await client.listResources();
        expect(result.resources.length).toBeGreaterThanOrEqual(1);
        expect(result.resources[0].uri).toContain('make://');
    });

    it('should read apps catalog resource', async () => {
        const result = await client.readResource({
            uri: 'make://apps',
        });

        expect(result.contents.length).toBe(1);
        const data = JSON.parse(result.contents[0].text as string);
        expect(data.totalApps).toBeGreaterThan(0);
        expect(data.apps.length).toBeGreaterThan(0);
    });
});
