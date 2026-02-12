/**
 * Make.com MCP Server — Production-grade
 * @author Daniel Shashko (https://www.linkedin.com/in/daniel-shashko/)
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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

function resolveServerVersion(): string {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
            return packageJson.version;
        }
    } catch {
        // Fallback below
    }
    return 'unknown';
}

const VERSION = resolveServerVersion();
const MODULE_CACHE_TTL_MS = Number(process.env['MAKE_MODULE_CACHE_TTL_MS'] || 5 * 60 * 1000);

type LiveModuleCatalog = {
    fetchedAt: number;
    ids: Set<string>;
};

const liveModuleCatalogCache = new Map<string, LiveModuleCatalog>();

// ── Database ──
// DATABASE_PATH env var overrides default; otherwise db.ts resolves
// to <packageRoot>/data/make-modules.db automatically.
const dbPath = process.env['DATABASE_PATH'];
const db = new MakeDatabase(dbPath);

// ── MCP Server ──
const server = new McpServer({
    name: 'make-mcp-server',
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

function hasValidApiKey(): boolean {
    const apiKey = process.env['MAKE_API_KEY'];
    return Boolean(apiKey && apiKey !== 'your_api_key_here');
}

function getMakeBaseUrl(): string {
    return process.env['MAKE_API_URL'] || 'https://eu1.make.com/api/v2';
}

function normalizeModuleId(moduleId: string): string {
    return moduleId.toLowerCase().replace(/[^a-z0-9:]/g, '');
}

function tokenizeModulePart(value: string): string[] {
    return value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function extractAllFlowModules(flow: any[], pathPrefix: string = 'Flow'): Array<{ module: string; path: string }> {
    const result: Array<{ module: string; path: string }> = [];
    for (let i = 0; i < flow.length; i++) {
        const node = flow[i];
        const pos = `${pathPrefix}[${i}]`;
        if (!node || typeof node !== 'object') continue;
        if (typeof node.module === 'string' && node.module.trim()) {
            result.push({ module: node.module, path: pos });
        }
        if (Array.isArray(node.routes)) {
            for (let r = 0; r < node.routes.length; r++) {
                const routeFlow = node.routes[r]?.flow;
                if (Array.isArray(routeFlow)) {
                    result.push(...extractAllFlowModules(routeFlow, `${pos}.routes[${r}]`));
                }
            }
        }
    }
    return result;
}

function replaceModuleIdsInFlow(flow: any[], replacements: Map<string, string>) {
    for (const node of flow) {
        if (!node || typeof node !== 'object') continue;
        if (typeof node.module === 'string' && replacements.has(node.module)) {
            node.module = replacements.get(node.module);
        }
        if (Array.isArray(node.routes)) {
            for (const route of node.routes) {
                if (Array.isArray(route?.flow)) {
                    replaceModuleIdsInFlow(route.flow, replacements);
                }
            }
        }
    }
}

function stripModuleVersionsInFlow(flow: any[]): number {
    let removed = 0;
    for (const node of flow) {
        if (!node || typeof node !== 'object') continue;
        if (node.version !== undefined) {
            delete node.version;
            removed++;
        }
        if (Array.isArray(node.routes)) {
            for (const route of node.routes) {
                if (Array.isArray(route?.flow)) {
                    removed += stripModuleVersionsInFlow(route.flow);
                }
            }
        }
    }
    return removed;
}

async function fetchLiveModuleIds(baseUrl: string, apiKey: string): Promise<Set<string> | null> {
    const cacheKey = `${baseUrl}`;
    const cached = liveModuleCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < MODULE_CACHE_TTL_MS) {
        return cached.ids;
    }

    try {
        const response = await axios.get(`${baseUrl}/modules`, {
            headers: { Authorization: `Token ${apiKey}` },
            timeout: 12000,
        });

        const rawModules = Array.isArray(response.data?.modules)
            ? response.data.modules
            : Array.isArray(response.data)
                ? response.data
                : [];

        const ids = new Set<string>();
        for (const item of rawModules) {
            if (typeof item === 'string') {
                if (item.includes(':')) ids.add(item);
                continue;
            }
            if (!item || typeof item !== 'object') continue;
            const candidates = [item.id, item.module, item.key];
            for (const candidate of candidates) {
                if (typeof candidate === 'string' && candidate.includes(':')) {
                    ids.add(candidate);
                }
            }
        }

        if (ids.size === 0) {
            logger.warn('Live modules endpoint returned no parseable module IDs');
            return null;
        }

        liveModuleCatalogCache.set(cacheKey, {
            fetchedAt: Date.now(),
            ids,
        });

        return ids;
    } catch (error: any) {
        logger.warn('Live module catalog fetch failed', {
            baseUrl,
            error: error?.message,
            status: error?.response?.status,
        });
        return null;
    }
}

function resolveClosestLiveModule(moduleId: string, liveIds: Set<string>): string | null {
    if (liveIds.has(moduleId)) return moduleId;

    const moduleNorm = normalizeModuleId(moduleId);
    const normalizedMap = new Map<string, string[]>();
    for (const liveId of liveIds) {
        const key = normalizeModuleId(liveId);
        const existing = normalizedMap.get(key);
        if (existing) existing.push(liveId);
        else normalizedMap.set(key, [liveId]);
    }

    const exactNormalized = normalizedMap.get(moduleNorm);
    if (exactNormalized && exactNormalized.length === 1) {
        return exactNormalized[0] ?? null;
    }

    const [appPart, modulePart] = moduleId.split(':');
    if (!appPart || !modulePart) return null;

    const targetTokens = new Set(tokenizeModulePart(modulePart));
    const candidates = Array.from(liveIds).filter((id) => id.startsWith(`${appPart}:`));
    if (candidates.length === 0) return null;

    let best: { id: string; score: number } | null = null;
    for (const candidate of candidates) {
        const candidatePart = candidate.split(':')[1] || '';
        const candidateTokens = tokenizeModulePart(candidatePart);
        const overlap = candidateTokens.filter((t) => targetTokens.has(t)).length;
        const score = overlap / Math.max(targetTokens.size, 1);
        if (!best || score > best.score) {
            best = { id: candidate, score };
        }
    }

    if (!best || best.score < 0.5) return null;
    return best.id;
}

function extractIm007ModuleId(errorData: any): string | null {
    const body = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || {});
    const match = body.match(/Module\s+not\s+found[^A-Za-z0-9]+([A-Za-z0-9_.:-]+:[A-Za-z0-9_.:-]+)/i);
    if (!match) return null;
    return match[1] ?? null;
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
            name: 'make-mcp-server',
            version: VERSION,
            description: 'MCP server for creating, validating, and deploying Make.com automation scenarios.',
        },
        quickStart: [
            '1. Call tools_documentation (this tool) to understand available capabilities',
            '2. Use search_modules to find the modules you need (e.g., "slack", "google sheets")',
            '3. Use get_module to get full parameter details for each module',
            '4. Optionally call check_account_compatibility to verify modules are available in your Make account/region',
            '5. Build a scenario blueprint JSON with a "flow" array of modules',
            '6. Call validate_scenario to check for errors before deploying',
            '7. Call create_scenario to deploy to Make.com (requires MAKE_API_KEY)',
        ],
        tools: {
            tools_documentation: 'Returns this documentation. Call first.',
            search_modules: 'Full-text search across 200+ Make.com modules. Params: query (required), app (optional filter).',
            get_module: 'Get detailed module info with all parameters. Params: moduleId (e.g., "slack:ActionPostMessage").',
            check_account_compatibility: 'Check whether modules are available in your current Make account/region using the live Make modules API.',
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
            'Do NOT set "version" on modules — Make.com auto-resolves the latest installed version',
            'Router filters cannot be set via the API — deploy without filters, then configure them in the Make.com UI',
            'The create_scenario tool auto-heals missing metadata, designer coords, and strips unsupported properties',
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
// TOOL: check_account_compatibility
// ══════════════════════════════════════════════════════════════

server.registerTool('check_account_compatibility', {
    title: 'Check Account Module Compatibility',
    description:
        'Checks whether module IDs are available in your current Make account and region. ' +
        'Supports explicit module list and/or extracting modules from a scenario blueprint.',
    inputSchema: {
        moduleIds: z.array(z.string().min(1).max(200)).max(200).optional().describe('Module IDs to verify (e.g., ["slack:ActionPostMessage"])'),
        blueprint: z.string().min(2).max(100000).optional().describe('Optional scenario blueprint JSON (stringified) to extract modules from'),
    },
}, async ({ moduleIds, blueprint }) => {
    try {
        const requested = new Set<string>((moduleIds || []).map((id) => id.trim()).filter(Boolean));

        if (blueprint) {
            let parsed: any;
            try {
                parsed = JSON.parse(blueprint);
            } catch {
                return fail('Invalid blueprint JSON. Ensure the blueprint is valid JSON.');
            }

            if (Array.isArray(parsed.flow)) {
                for (const item of extractAllFlowModules(parsed.flow)) {
                    requested.add(item.module);
                }
            }
        }

        if (requested.size === 0) {
            return fail('Provide at least one module ID via moduleIds or include a blueprint with a flow array.');
        }

        if (!hasValidApiKey()) {
            return ok({
                checkedModules: Array.from(requested),
                liveCatalogChecked: false,
                compatible: null,
                reason: 'MAKE_API_KEY not configured. Cannot verify account/region availability.',
            });
        }

        const apiKey = process.env['MAKE_API_KEY']!;
        const baseUrl = getMakeBaseUrl();
        const liveIds = await fetchLiveModuleIds(baseUrl, apiKey);

        if (!liveIds) {
            return ok({
                checkedModules: Array.from(requested),
                liveCatalogChecked: false,
                compatible: null,
                reason: 'Live Make modules endpoint is unavailable for this environment.',
            });
        }

        const results = Array.from(requested).map((moduleId) => {
            const available = liveIds.has(moduleId);
            const suggestedReplacement = available ? null : resolveClosestLiveModule(moduleId, liveIds);
            return {
                moduleId,
                available,
                suggestedReplacement,
            };
        });

        const unavailable = results.filter((r) => !r.available);
        return ok({
            liveCatalogChecked: true,
            makeApiUrl: baseUrl,
            liveModuleCount: liveIds.size,
            checkedCount: results.length,
            incompatibleCount: unavailable.length,
            compatible: unavailable.length === 0,
            modules: results,
        });
    } catch (error: any) {
        logger.error('check_account_compatibility failed', { error: error.message });
        return fail(`Compatibility check failed: ${error.message}`);
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

        // Recursive helper to validate a flow array (handles router sub-routes)
        const validateFlow = (flow: any[], pathPrefix: string) => {
            for (let i = 0; i < flow.length; i++) {
                const flowModule = flow[i];
                const pos = `${pathPrefix}[${i}]`;

                if (!flowModule || typeof flowModule !== 'object') {
                    errors.push(`${pos}: Each flow item must be an object.`);
                    continue;
                }

                if (!flowModule.module || typeof flowModule.module !== 'string') {
                    errors.push(`${pos}: Missing or invalid "module" property.`);
                    continue;
                }

                // Warn about missing id
                if (flowModule.id === undefined) {
                    warnings.push(`${pos} (${flowModule.module}): Missing "id" field. Each module should have a unique numeric ID.`);
                }

                const schema = db.getModule(flowModule.module);
                if (!schema) {
                    errors.push(`${pos}: Unknown module "${flowModule.module}". Use search_modules to find valid IDs.`);
                    continue;
                }

                if (flowModule.version !== undefined) {
                    warnings.push(`${pos} (${flowModule.module}): Module "version" is set in blueprint. This can trigger IM007; omit module version to let Make resolve correctly.`);
                }

                validatedModules.push(flowModule.module);

                // Check required parameters — skip "routes" for Router (it's a top-level flow property)
                const params = JSON.parse(schema.parameters);
                for (const param of params) {
                    if (param.required) {
                        // Router "routes" lives as a sibling key on the flow item, not inside parameters/mapper
                        if (flowModule.module === 'builtin:BasicRouter' && param.name === 'routes') {
                            if (!flowModule.routes || !Array.isArray(flowModule.routes) || flowModule.routes.length === 0) {
                                errors.push(`${pos} (${flowModule.module}): Router must have a "routes" array with at least one route.`);
                            }
                            continue;
                        }
                        const hasParam = flowModule.parameters?.[param.name] !== undefined
                            || flowModule.mapper?.[param.name] !== undefined;
                        if (!hasParam) {
                            errors.push(`${pos} (${flowModule.module}): Missing required parameter "${param.name}".`);
                        }
                    }
                }

                // Recurse into router routes
                if (flowModule.routes && Array.isArray(flowModule.routes)) {
                    for (let r = 0; r < flowModule.routes.length; r++) {
                        const route = flowModule.routes[r];
                        if (route.flow && Array.isArray(route.flow)) {
                            validateFlow(route.flow, `${pos}.routes[${r}]`);
                        }
                    }
                }
            }
        };

        if (!parsed.flow || !Array.isArray(parsed.flow)) {
            errors.push('Blueprint must contain a "flow" array of modules.');
        } else {
            if (parsed.flow.length === 0) {
                errors.push('Flow array is empty. Add at least one module.');
            }

            validateFlow(parsed.flow, 'Flow');

            // Warn if first module is not a trigger
            if (parsed.flow.length > 0 && parsed.flow[0]?.module) {
                const firstModule = db.getModule(parsed.flow[0].module);
                if (firstModule && firstModule.type !== 'trigger') {
                    warnings.push('First module should typically be a trigger. Your scenario has no trigger entry point.');
                }
            }
        }

        // Warn about missing metadata (Make.com requires it)
        if (!parsed.metadata) {
            warnings.push('Blueprint is missing "metadata" section. It will be auto-injected during deployment.');
        }

        const compatibilityIssues: Array<{ module: string; suggestion?: string; paths: string[] }> = [];
        let liveCatalogChecked = false;

        if (parsed.flow && Array.isArray(parsed.flow) && hasValidApiKey()) {
            const apiKey = process.env['MAKE_API_KEY']!;
            const baseUrl = getMakeBaseUrl();
            const liveIds = await fetchLiveModuleIds(baseUrl, apiKey);

            if (liveIds) {
                liveCatalogChecked = true;
                const allModules = extractAllFlowModules(parsed.flow);
                const byModule = new Map<string, string[]>();

                for (const m of allModules) {
                    const existing = byModule.get(m.module);
                    if (existing) existing.push(m.path);
                    else byModule.set(m.module, [m.path]);
                }

                for (const [moduleId, paths] of byModule.entries()) {
                    if (liveIds.has(moduleId)) continue;
                    const suggestion = resolveClosestLiveModule(moduleId, liveIds) || undefined;
                    const issue: { module: string; suggestion?: string; paths: string[] } = {
                        module: moduleId,
                        paths,
                    };
                    if (suggestion) {
                        issue.suggestion = suggestion;
                    }
                    compatibilityIssues.push(issue);
                    if (suggestion) {
                        errors.push(`Module "${moduleId}" is not available in this Make account/region. Suggested replacement: "${suggestion}".`);
                    } else {
                        errors.push(`Module "${moduleId}" is not available in this Make account/region.`);
                    }
                }
            } else {
                warnings.push('Live module compatibility check skipped (Make modules endpoint unavailable).');
            }
        }

        const result = {
            valid: errors.length === 0,
            errors,
            warnings,
            modulesValidated: validatedModules,
            accountCompatibility: {
                liveCatalogChecked,
                incompatibleModules: compatibilityIssues,
            },
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

        const baseUrl = getMakeBaseUrl();

        // Parse and auto-heal the blueprint
        let parsed: any;
        try {
            parsed = JSON.parse(blueprint);
        } catch {
            return fail('Invalid blueprint JSON. Run validate_scenario first.');
        }

        // Auto-inject metadata if missing (Make.com requires it)
        if (!parsed.metadata) {
            parsed.metadata = {
                version: 1,
                scenario: {
                    roundtrips: 1,
                    maxErrors: 3,
                    autoCommit: true,
                    autoCommitTriggerLast: true,
                    sequential: false,
                    confidential: false,
                    dataloss: false,
                    dlq: false,
                    freshVariables: false,
                },
                designer: { orphans: [] },
            };
            logger.info('create_scenario: auto-injected missing metadata');
        }

        // Auto-inject designer metadata on flow modules if missing (recursively).
        // NOTE: We intentionally do NOT inject "version" — Make.com resolves
        // the latest installed version when omitted.  Forcing version:1 breaks
        // modules that have been updated (e.g. HTTP is currently v4).
        const healFlow = (flow: any[]) => {
            for (const mod of flow) {
                if (!mod || typeof mod !== 'object') continue;
                // Always strip module versions coming from imported/generated blueprints.
                // A pinned version often causes IM007 when the account/region has different module revisions.
                if (mod.version !== undefined) {
                    delete mod.version;
                }
                if (!mod.metadata) mod.metadata = { designer: { x: 0, y: 0 } };
                else if (!mod.metadata.designer) mod.metadata.designer = { x: 0, y: 0 };
                // Recurse into router routes
                if (mod.routes && Array.isArray(mod.routes)) {
                    for (const route of mod.routes) {
                        // Strip "filter" from route objects — Make.com API rejects
                        // it as an additional property.  Router filters must be
                        // configured via the Make.com UI after deployment.
                        if (route.filter !== undefined) {
                            delete route.filter;
                            logger.info('create_scenario: stripped unsupported "filter" from router route');
                        }
                        if (route.flow && Array.isArray(route.flow)) {
                            healFlow(route.flow);
                        }
                    }
                }
            }
        };
        if (parsed.flow && Array.isArray(parsed.flow)) {
            healFlow(parsed.flow);
        }

        const removedVersionsCount = Array.isArray(parsed.flow) ? stripModuleVersionsInFlow(parsed.flow) : 0;
        if (removedVersionsCount > 0) {
            logger.info('create_scenario: stripped module version fields', { removedVersionsCount });
        }

        // Account-aware module compatibility check and auto-remap
        const liveIds = await fetchLiveModuleIds(baseUrl, apiKey);
        const remappedModules: Array<{ from: string; to: string }> = [];
        if (liveIds && Array.isArray(parsed.flow)) {
            const byModule = new Set(extractAllFlowModules(parsed.flow).map((m) => m.module));
            const replacements = new Map<string, string>();
            const unavailable: string[] = [];

            for (const moduleId of byModule) {
                if (liveIds.has(moduleId)) continue;
                const replacement = resolveClosestLiveModule(moduleId, liveIds);
                if (replacement && replacement !== moduleId) {
                    replacements.set(moduleId, replacement);
                    remappedModules.push({ from: moduleId, to: replacement });
                } else {
                    unavailable.push(moduleId);
                }
            }

            if (replacements.size > 0) {
                replaceModuleIdsInFlow(parsed.flow, replacements);
                logger.info('create_scenario: auto-remapped modules', { remappedModules });
            }

            if (unavailable.length > 0) {
                return fail(
                    'Cannot deploy: one or more modules are not available for this Make account/region. ' +
                    `Unavailable: ${unavailable.join(', ')}. Run validate_scenario to get suggestions.`
                );
            }
        }

        const buildPayload = () => {
            const payload: any = {
                teamId: resolvedTeamId,
                name,
                blueprint: JSON.stringify(parsed),
                scheduling: JSON.stringify({ type: 'on-demand' }),
            };
            if (folderId) payload.folderId = folderId;
            return payload;
        };

        logger.info('create_scenario', { name, teamId: resolvedTeamId, baseUrl });

        let response: any;
        let attempt = 0;
        const maxAttempts = 2;
        let strippedVersionsForRetry = false;

        while (attempt < maxAttempts) {
            attempt++;
            try {
                response = await axios.post(
                    `${baseUrl}/scenarios?confirmed=true`,
                    buildPayload(),
                    {
                        headers: {
                            'Authorization': `Token ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 30000,
                    }
                );
                break;
            } catch (error: any) {
                const status = error.response?.status;
                const data = error.response?.data;
                const missingModule = extractIm007ModuleId(data);

                if (status === 400 && missingModule && liveIds && attempt < maxAttempts) {
                    const replacement = resolveClosestLiveModule(missingModule, liveIds);
                    if (replacement && replacement !== missingModule && Array.isArray(parsed.flow)) {
                        const replacements = new Map<string, string>([[missingModule, replacement]]);
                        replaceModuleIdsInFlow(parsed.flow, replacements);
                        remappedModules.push({ from: missingModule, to: replacement });
                        logger.warn('create_scenario: retrying after IM007 remap', { missingModule, replacement, attempt });
                        continue;
                    }
                }

                if (status === 400 && attempt < maxAttempts && Array.isArray(parsed.flow) && !strippedVersionsForRetry) {
                    const data = error.response?.data;
                    const code = data?.code;
                    if (code === 'IM007') {
                        const stripped = stripModuleVersionsInFlow(parsed.flow);
                        if (stripped > 0) {
                            strippedVersionsForRetry = true;
                            logger.warn('create_scenario: retrying after IM007 by stripping module versions', {
                                stripped,
                                attempt,
                            });
                            continue;
                        }
                    }
                }

                throw error;
            }
        }

        if (!response) {
            return fail('Failed to create scenario after retry attempts.');
        }

        const createdScenario = response.data?.scenario || response.data;
        const postWarnings: string[] = [];
        if (createdScenario?.isinvalid === true) {
            postWarnings.push('Scenario was created but marked invalid by Make. Check modules/connections in Make UI.');
        }

        return ok({
            success: true,
            scenario: response.data,
            remappedModules,
            warnings: postWarnings,
            message: `Scenario "${name}" created successfully.`,
        });
    } catch (error: any) {
        // Extract the most useful error message from Make.com's response
        const data = error.response?.data;
        const msg = data?.detail || data?.message || (typeof data === 'string' ? data : null) || error.message;
        const status = error.response?.status;
        logger.error('create_scenario failed', { error: msg, status, responseData: data });

        if (status === 401) {
            return fail('Authentication failed. Check your MAKE_API_KEY.');
        }
        if (status === 403) {
            return fail('Access denied. Check your API key permissions and team ID.');
        }
        if (status === 400 && data?.code === 'IM007') {
            const detail = data?.detail || data?.message || 'Invalid blueprint';
            return fail(
                `Failed to create scenario (HTTP 400): ${JSON.stringify(data, null, 2)}\n` +
                `Hint: IM007 usually means module ID/version incompatibility for this account/region. ` +
                `Use check_account_compatibility first and verify MAKE_API_URL matches your Make region (eu1/eu2/us1/us2). ` +
                `Detail: ${detail}`
            );
        }
        // Include full response data for debugging 400 errors
        const detail = data ? JSON.stringify(data, null, 2) : msg;
        return fail(`Failed to create scenario (HTTP ${status || 'unknown'}): ${detail}`);
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
