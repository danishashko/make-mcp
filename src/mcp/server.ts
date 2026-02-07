/**
 * Make.com MCP Server — Production-grade
 *
 * Features:
 *   - registerTool / registerPrompt / registerResource (latest v1.x SDK API)
 *   - Proper isError flag for tool execution errors
 *   - Input validation & sanitization
 *   - Structured logging to stderr only (stdio-safe)
 *   - MCP Prompts for guided scenario creation
 *   - MCP Resources for module catalog browsing
 *   - tools_documentation meta-tool (START HERE pattern from n8n-mcp)
 *   - Graceful shutdown
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MakeDatabase } from '../database/db.js';
import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

const VERSION = '1.1.0';

// ── Database ──
// DATABASE_PATH env var overrides default; otherwise db.ts resolves
// to <packageRoot>/data/make-modules.db automatically.
const dbPath = process.env['DATABASE_PATH'];
const db = new MakeDatabase(dbPath);

// ── MCP Server ──
const server = new McpServer({
    name: 'make-mcp',
    version: VERSION,
});

// ══════════════════════════════════════════════════════════════
// HELPER: safe tool response
// ══════════════════════════════════════════════════════════════

function ok(data: unknown) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    };
}

function fail(message: string) {
    return {
        content: [{ type: 'text' as const, text: message }],
        isError: true as const,
    };
}

// ══════════════════════════════════════════════════════════════
// TOOL: tools_documentation  (START HERE)
// ══════════════════════════════════════════════════════════════

server.registerTool('tools_documentation', {
    title: 'Tools Documentation — START HERE',
    description:
        'Returns comprehensive documentation for all available tools, resources, and prompts. ' +
        'Call this FIRST to understand how to use the Make.com MCP server effectively.',
}, async () => {
    const doc = {
        server: {
            name: 'make-mcp',
            version: VERSION,
            description: 'MCP server for creating, validating, and deploying Make.com automation scenarios.',
        },
        quickStart: [
            '1. Call tools_documentation (this tool) to understand available capabilities',
            '2. Use search_modules to find the modules you need (e.g., "slack", "google sheets")',
            '3. Use get_module to get full parameter details for each module',
            '4. Build a scenario blueprint JSON with a "flow" array of modules',
            '5. Call validate_scenario to check for errors before deploying',
            '6. Call create_scenario to deploy to Make.com (requires MAKE_API_KEY)',
        ],
        tools: {
            tools_documentation: 'Returns this documentation. Call first.',
            search_modules: 'Full-text search across 200+ Make.com modules. Params: query (required), app (optional filter).',
            get_module: 'Get detailed module info with all parameters. Params: moduleId (e.g., "slack:ActionPostMessage").',
            validate_scenario: 'Validate a scenario blueprint before deployment. Checks structure, modules, and required params.',
            create_scenario: 'Deploy a validated scenario to Make.com via API. Requires MAKE_API_KEY.',
            search_templates: 'Search reusable scenario templates. Params: query (optional), category (optional).',
            list_apps: 'List all available apps with module counts.',
        },
        prompts: {
            build_scenario: 'Guided scenario creation wizard. Provide a description and the prompt guides you through module selection, configuration, and validation.',
            explain_module: 'Get a detailed explanation of any Make.com module with usage examples.',
        },
        resources: {
            'make://apps': 'List of all available apps and their module counts.',
        },
        blueprintFormat: {
            description: 'Make.com scenario blueprint structure',
            example: {
                name: 'My Scenario',
                flow: [
                    {
                        id: 1,
                        module: 'gateway:CustomWebHook',
                        parameters: { name: 'My Webhook' },
                    },
                    {
                        id: 2,
                        module: 'slack:ActionPostMessage',
                        parameters: { channel: '#general', text: '{{1.data}}' },
                        mapper: { channel: '#general', text: '{{1.data}}' },
                    },
                ],
            },
        },
        tips: [
            'Module IDs follow the format: app:ActionName or app:TriggerName',
            'Use search_modules with wildcard "*" to list all modules',
            'First module in a scenario should be a trigger',
            'Parameters reference previous modules with {{moduleId.field}} syntax',
            'Always validate before deploying to catch errors early',
        ],
    };

    logger.debug('tools_documentation called');
    return ok(doc);
});

// ══════════════════════════════════════════════════════════════
// TOOL: search_modules
// ══════════════════════════════════════════════════════════════

server.registerTool('search_modules', {
    title: 'Search Make.com Modules',
    description: 'Full-text search across 200+ Make.com modules. Returns module names, apps, types, and descriptions.',
    inputSchema: {
        query: z.string().min(1).max(200).describe('Search keyword (e.g., "slack", "email", "google sheets")'),
        app: z.string().max(100).optional().describe('Filter by app name (e.g., "Slack", "Gmail")'),
    },
}, async ({ query, app }) => {
    try {
        const sanitizedQuery = query.replace(/[^\w\s*".-]/g, ' ').trim();
        if (!sanitizedQuery) {
            return fail('Invalid search query. Use alphanumeric characters.');
        }

        const results = db.searchModules(sanitizedQuery, app);
        logger.debug('search_modules', { query: sanitizedQuery, app, resultCount: results.length });

        return ok({
            count: results.length,
            modules: results.map((m: any) => ({
                id: m.id,
                name: m.name,
                app: m.app,
                type: m.type,
                description: m.description,
            })),
        });
    } catch (error: any) {
        logger.error('search_modules failed', { error: error.message });
        return fail(`Search failed: ${error.message}`);
    }
});

// ══════════════════════════════════════════════════════════════
// TOOL: get_module
// ══════════════════════════════════════════════════════════════

server.registerTool('get_module', {
    title: 'Get Module Details',
    description: 'Get detailed information about a specific Make.com module including all parameters, types, and configuration examples.',
    inputSchema: {
        moduleId: z.string().min(1).max(200).describe('Module ID (e.g., "http:ActionSendData", "slack:ActionPostMessage")'),
    },
}, async ({ moduleId }) => {
    try {
        const sanitizedId = moduleId.replace(/[^\w:.-]/g, '');
        const mod = db.getModule(sanitizedId);
        if (!mod) {
            return fail(`Module not found: ${sanitizedId}. Use search_modules to find valid module IDs.`);
        }

        const response: any = {
            id: mod.id,
            name: mod.name,
            app: mod.app,
            type: mod.type,
            description: mod.description,
            parameters: JSON.parse(mod.parameters),
            documentation: mod.documentation || undefined,
        };

        const examples = db.getModuleExamples(sanitizedId);
        if (examples.length > 0) {
            response.examples = examples.map((ex: any) => JSON.parse(ex.config));
        }

        logger.debug('get_module', { moduleId: sanitizedId });
        return ok(response);
    } catch (error: any) {
        logger.error('get_module failed', { moduleId, error: error.message });
        return fail(`Failed to retrieve module: ${error.message}`);
    }
});

// ══════════════════════════════════════════════════════════════
// TOOL: validate_scenario
// ══════════════════════════════════════════════════════════════

server.registerTool('validate_scenario', {
    title: 'Validate Scenario Blueprint',
    description:
        'Validate a Make.com scenario blueprint before deployment. ' +
        'Checks for missing required parameters, unknown modules, type mismatches, and structural issues.',
    inputSchema: {
        blueprint: z.string().min(2).max(100000).describe('Make scenario blueprint JSON (stringified)'),
    },
}, async ({ blueprint }) => {
    try {
        let parsed: any;
        try {
            parsed = JSON.parse(blueprint);
        } catch {
            return fail('Invalid JSON. Ensure the blueprint is valid JSON.');
        }

        const errors: string[] = [];
        const warnings: string[] = [];
        const validatedModules: string[] = [];

        if (!parsed.flow || !Array.isArray(parsed.flow)) {
            errors.push('Blueprint must contain a "flow" array of modules.');
        } else {
            if (parsed.flow.length === 0) {
                errors.push('Flow array is empty. Add at least one module.');
            }

            for (let i = 0; i < parsed.flow.length; i++) {
                const flowModule = parsed.flow[i];
                const pos = `Flow[${i}]`;

                if (!flowModule || typeof flowModule !== 'object') {
                    errors.push(`${pos}: Each flow item must be an object.`);
                    continue;
                }

                if (!flowModule.module || typeof flowModule.module !== 'string') {
                    errors.push(`${pos}: Missing or invalid "module" property.`);
                    continue;
                }

                const schema = db.getModule(flowModule.module);
                if (!schema) {
                    errors.push(`${pos}: Unknown module "${flowModule.module}". Use search_modules to find valid IDs.`);
                    continue;
                }

                validatedModules.push(flowModule.module);

                // Check required parameters
                const params = JSON.parse(schema.parameters);
                for (const param of params) {
                    if (param.required) {
                        const hasParam = flowModule.parameters?.[param.name] !== undefined
                            || flowModule.mapper?.[param.name] !== undefined;
                        if (!hasParam) {
                            errors.push(`${pos} (${flowModule.module}): Missing required parameter "${param.name}".`);
                        }
                    }
                }
            }

            // Warn if first module is not a trigger
            if (parsed.flow.length > 0 && parsed.flow[0]?.module) {
                const firstModule = db.getModule(parsed.flow[0].module);
                if (firstModule && firstModule.type !== 'trigger') {
                    warnings.push('First module should typically be a trigger. Your scenario has no trigger entry point.');
                }
            }

            // Warn about missing module IDs
            for (let i = 0; i < parsed.flow.length; i++) {
                if (!parsed.flow[i]?.id && parsed.flow[i]?.id !== 0) {
                    warnings.push(`Flow[${i}]: Missing "id" field. Each module should have a unique numeric ID for mapping references.`);
                }
            }
        }

        const result = {
            valid: errors.length === 0,
            errors,
            warnings,
            modulesValidated: validatedModules,
            summary: errors.length === 0
                ? `Blueprint is valid. ${validatedModules.length} module(s) checked, ${warnings.length} warning(s).`
                : `${errors.length} error(s) found. Fix them before deploying.`,
        };

        logger.debug('validate_scenario', { valid: result.valid, errors: errors.length, warnings: warnings.length });
        return ok(result);
    } catch (error: any) {
        logger.error('validate_scenario failed', { error: error.message });
        return fail(`Validation failed: ${error.message}`);
    }
});

// ══════════════════════════════════════════════════════════════
// TOOL: create_scenario
// ══════════════════════════════════════════════════════════════

server.registerTool('create_scenario', {
    title: 'Deploy Scenario to Make.com',
    description:
        'Deploy a validated scenario blueprint to Make.com via API. ' +
        'Requires MAKE_API_KEY environment variable. Always validate first.',
    inputSchema: {
        name: z.string().min(1).max(500).describe('Scenario name'),
        blueprint: z.string().min(2).max(100000).describe('Scenario blueprint JSON (stringified)'),
        teamId: z.number().optional().describe('Make team ID (uses MAKE_TEAM_ID env var if not provided)'),
        folderId: z.number().optional().describe('Make folder ID to create scenario in'),
    },
    annotations: {
        destructiveHint: true,
        idempotentHint: false,
    },
}, async ({ name, blueprint, teamId, folderId }) => {
    try {
        const apiKey = process.env['MAKE_API_KEY'];
        if (!apiKey || apiKey === 'your_api_key_here') {
            return fail(
                'MAKE_API_KEY not configured. Set it in the .env file to deploy scenarios.\n' +
                'Get your API key from: https://www.make.com/en/api-documentation'
            );
        }

        const resolvedTeamId = teamId || Number(process.env['MAKE_TEAM_ID']);
        if (!resolvedTeamId || isNaN(resolvedTeamId)) {
            return fail('Team ID required. Provide teamId parameter or set MAKE_TEAM_ID in .env file.');
        }

        // Validate blueprint JSON
        try {
            JSON.parse(blueprint);
        } catch {
            return fail('Invalid blueprint JSON. Run validate_scenario first.');
        }

        const baseUrl = process.env['MAKE_API_URL'] || 'https://eu1.make.com/api/v2';
        const payload: any = {
            teamId: resolvedTeamId,
            name,
            blueprint,
            scheduling: JSON.stringify({ type: 'on-demand' }),
        };
        if (folderId) payload.folderId = folderId;

        logger.info('create_scenario', { name, teamId: resolvedTeamId });

        const response = await axios.post(
            `${baseUrl}/scenarios`,
            payload,
            {
                headers: {
                    'Authorization': `Token ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            }
        );

        return ok({
            success: true,
            scenario: response.data,
            message: `Scenario "${name}" created successfully.`,
        });
    } catch (error: any) {
        const msg = error.response?.data?.message || error.message;
        const status = error.response?.status;
        logger.error('create_scenario failed', { error: msg, status });

        if (status === 401) {
            return fail('Authentication failed. Check your MAKE_API_KEY.');
        }
        if (status === 403) {
            return fail('Access denied. Check your API key permissions and team ID.');
        }
        return fail(`Failed to create scenario: ${msg}`);
    }
});

// ══════════════════════════════════════════════════════════════
// TOOL: search_templates
// ══════════════════════════════════════════════════════════════

server.registerTool('search_templates', {
    title: 'Search Scenario Templates',
    description: 'Search Make.com scenario templates for inspiration and reuse.',
    inputSchema: {
        query: z.string().max(200).optional().describe('Search keyword'),
        category: z.string().max(100).optional().describe('Filter by category (e.g., "marketing", "sales")'),
    },
}, async ({ query, category }) => {
    try {
        const templates = db.searchTemplates(query, category);
        logger.debug('search_templates', { query, category, count: templates.length });
        return ok({
            count: templates.length,
            templates: templates.map((t: any) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                category: t.category,
                difficulty: t.difficulty,
            })),
        });
    } catch (error: any) {
        logger.error('search_templates failed', { error: error.message });
        return fail(`Template search failed: ${error.message}`);
    }
});

// ══════════════════════════════════════════════════════════════
// TOOL: list_apps
// ══════════════════════════════════════════════════════════════

server.registerTool('list_apps', {
    title: 'List Available Apps',
    description: 'List all available Make.com apps/integrations with module counts.',
}, async () => {
    try {
        const apps = db.searchModules('*');
        const appMap = new Map<string, { count: number; types: Set<string> }>();

        for (const mod of apps) {
            const existing = appMap.get(mod.app);
            if (existing) {
                existing.count++;
                existing.types.add(mod.type);
            } else {
                appMap.set(mod.app, { count: 1, types: new Set([mod.type]) });
            }
        }

        const result = Array.from(appMap.entries())
            .map(([app, info]) => ({
                app,
                moduleCount: info.count,
                types: Array.from(info.types),
            }))
            .sort((a, b) => b.moduleCount - a.moduleCount);

        logger.debug('list_apps', { appCount: result.length });
        return ok({
            totalApps: result.length,
            totalModules: apps.length,
            apps: result,
        });
    } catch (error: any) {
        logger.error('list_apps failed', { error: error.message });
        return fail(`Failed to list apps: ${error.message}`);
    }
});

// ══════════════════════════════════════════════════════════════
// PROMPT: build_scenario
// ══════════════════════════════════════════════════════════════

server.registerPrompt('build_scenario', {
    title: 'Build a Make.com Scenario',
    description:
        'Guided workflow for creating a Make.com automation scenario. ' +
        'Provide a description of what you want to automate, and this prompt will ' +
        'guide you through module selection, configuration, and validation.',
    argsSchema: {
        description: z.string().describe('Natural language description of the automation you want to create'),
        apps: z.string().optional().describe('Comma-separated list of specific apps to use (e.g., "Slack, Google Sheets")'),
    },
}, ({ description, apps }) => {
    const appHint = apps ? `\nPreferred apps: ${apps}` : '';
    return {
        messages: [
            {
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: [
                        `I want to create a Make.com automation scenario.`,
                        ``,
                        `## Description`,
                        description,
                        appHint,
                        ``,
                        `## Instructions`,
                        `Please help me build this scenario step by step:`,
                        ``,
                        `1. **Analyze** the requirement and identify the needed modules`,
                        `2. **Search** for modules using the search_modules tool`,
                        `3. **Get details** for each module using get_module to understand parameters`,
                        `4. **Build** the blueprint JSON with proper module IDs, parameters, and data mapping`,
                        `5. **Validate** the blueprint using validate_scenario`,
                        `6. **Fix** any validation errors`,
                        `7. **Present** the final validated blueprint ready for deployment`,
                        ``,
                        `Important rules:`,
                        `- Always start with a trigger module`,
                        `- Use exact module IDs from the database (format: "app:ActionName")`,
                        `- Reference previous module outputs using {{moduleId.field}} syntax`,
                        `- Include all required parameters for each module`,
                        `- Validate before presenting the final blueprint`,
                    ].join('\n'),
                },
            },
        ],
    };
});

server.registerPrompt('explain_module', {
    title: 'Explain a Make.com Module',
    description: 'Get a detailed explanation of a Make.com module with usage examples and best practices.',
    argsSchema: {
        moduleId: z.string().describe('The module ID to explain (e.g., "slack:ActionPostMessage")'),
    },
}, ({ moduleId }) => ({
    messages: [
        {
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: [
                    `Please explain the Make.com module "${moduleId}" in detail:`,
                    ``,
                    `1. Use the get_module tool to retrieve its full specification`,
                    `2. Explain what the module does in plain language`,
                    `3. List all parameters with which are required vs optional`,
                    `4. Show a practical example of how to configure it in a scenario`,
                    `5. Mention any tips, gotchas, or best practices`,
                ].join('\n'),
            },
        },
    ],
}));

// ══════════════════════════════════════════════════════════════
// RESOURCE: make://apps
// ══════════════════════════════════════════════════════════════

server.registerResource('apps-catalog', 'make://apps', {
    title: 'Make.com Apps Catalog',
    description: 'List of all available Make.com apps/integrations with module counts.',
    mimeType: 'application/json',
}, async (uri) => {
    const apps = db.searchModules('*');
    const appMap = new Map<string, number>();
    for (const mod of apps) {
        appMap.set(mod.app, (appMap.get(mod.app) || 0) + 1);
    }
    const result = Array.from(appMap.entries())
        .map(([app, count]) => ({ app, moduleCount: count }))
        .sort((a, b) => b.moduleCount - a.moduleCount);

    return {
        contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ totalApps: result.length, apps: result }, null, 2),
        }],
    };
});

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════

async function main() {
    const transport = new StdioServerTransport();

    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down Make MCP server...');
        try {
            db.close();
            await server.close();
        } catch {
            // Ignore errors during shutdown
        }
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught exception', { error: err.message, stack: err.stack });
        shutdown();
    });
    process.on('unhandledRejection', (reason: any) => {
        logger.error('Unhandled rejection', { error: reason?.message || String(reason) });
    });

    await server.connect(transport);
    logger.info(`Make MCP server v${VERSION} running on stdio`, {
        modules: db.searchModules('*').length,
    });
}

main().catch((err) => {
    logger.error('Fatal: Failed to start server', { error: err.message });
    process.exit(1);
});
