import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DEFAULT_MODULES = [
    'gateway:CustomWebHook',
    'gateway:WebhookRespond',
    'slack:ActionPostMessage',
];

const SAMPLE_BLUEPRINT = {
    name: 'Smoke Test Compatibility Blueprint',
    flow: [
        {
            id: 1,
            module: 'gateway:CustomWebHook',
            parameters: { name: 'Smoke Test Webhook' },
        },
        {
            id: 2,
            module: 'gateway:WebhookRespond',
            parameters: {
                status: 200,
                body: '{"ok":true}',
                headers: [{ name: 'Content-Type', value: 'application/json' }],
            },
        },
    ],
};

async function main() {
    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['tsx', 'src/mcp/server.ts'],
        cwd: process.cwd(),
        env: process.env,
        stderr: 'pipe',
    });

    const client = new Client({
        name: 'smoke-compat-client',
        version: '1.0.0',
    });

    try {
        await client.connect(transport);

        const tools = await client.listTools();
        const hasCompatTool = tools.tools.some((t) => t.name === 'check_account_compatibility');
        if (!hasCompatTool) {
            throw new Error('Tool check_account_compatibility is not registered.');
        }

        const compatResult = await client.callTool({
            name: 'check_account_compatibility',
            arguments: {
                moduleIds: DEFAULT_MODULES,
                blueprint: JSON.stringify(SAMPLE_BLUEPRINT),
            },
        });

        const compatData = JSON.parse(compatResult.content?.[0]?.text || '{}');

        const validateResult = await client.callTool({
            name: 'validate_scenario',
            arguments: {
                blueprint: JSON.stringify(SAMPLE_BLUEPRINT),
            },
        });

        const validateData = JSON.parse(validateResult.content?.[0]?.text || '{}');

        console.log('--- make-mcp smoke:compat ---');
        console.log(`liveCatalogChecked: ${compatData.liveCatalogChecked ?? false}`);
        console.log(`checkedCount: ${compatData.checkedCount ?? compatData.checkedModules?.length ?? 0}`);
        console.log(`incompatibleCount: ${compatData.incompatibleCount ?? 'n/a'}`);
        if (compatData.reason) {
            console.log(`compatibilityNote: ${compatData.reason}`);
        }
        console.log(`validate.valid: ${validateData.valid}`);
        console.log(`validate.errors: ${(validateData.errors || []).length}`);
        console.log(`validate.warnings: ${(validateData.warnings || []).length}`);

        if (Array.isArray(compatData.modules)) {
            const incompatible = compatData.modules.filter((m) => m.available === false);
            if (incompatible.length > 0) {
                console.log('incompatibleModules:');
                for (const mod of incompatible) {
                    console.log(`- ${mod.moduleId} -> ${mod.suggestedReplacement || 'no suggestion'}`);
                }
            }
        }

        console.log('smoke:compat completed');
    } finally {
        try {
            await client.close();
        } catch {
            // noop
        }
    }
}

main().catch((error) => {
    console.error('smoke:compat failed:', error.message);
    process.exit(1);
});
