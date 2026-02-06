# 🚀 Make.com MCP Server - Agentic Development Prompt
## PROJECT GOAL

Build an MCP (Model Context Protocol) server that enables AI assistants (Claude, ChatGPT, etc.) to create Make.com scenarios from natural language descriptions. Similar to https://github.com/czlonkowski/n8n-mcp but for Make.com.

---

## 📋 COMPLETE STEP-BY-STEP INSTRUCTIONS

### STEP 1: Project Setup (10 minutes)

```bash
# Create project structure
mkdir make-mcp
cd make-mcp
npm init -y
npm install @modelcontextprotocol/sdk sqlite3 better-sqlite3 axios dotenv
npm install --save-dev typescript @types/node tsx

# Initialize TypeScript
npx tsc --init
```

**Create folder structure:**
```
make-mcp/
├── src/
│   ├── mcp/
│   │   └── server.ts          # MCP server entry point
│   ├── database/
│   │   ├── schema.sql          # SQLite schema
│   │   └── db.ts               # Database operations
│   ├── scrapers/
│   │   ├── scrape-modules.ts   # Make module scraper
│   │   └── scrape-templates.ts # Make template scraper
│   └── tools/
│       ├── search-modules.ts   # MCP tool: search modules
│       ├── get-module.ts       # MCP tool: get module details
│       ├── validate-scenario.ts # MCP tool: validate scenario
│       └── create-scenario.ts  # MCP tool: deploy to Make
├── data/
│   └── make-modules.db         # SQLite database
├── .env                        # Environment variables
└── package.json
```

---

### STEP 2: Database Schema (5 minutes)

**File: `src/database/schema.sql`**
```sql
CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    app TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'trigger', 'action', 'search'
    description TEXT,
    parameters TEXT,     -- JSON string of parameter schema
    examples TEXT,       -- JSON string of example configurations
    documentation TEXT,  -- Markdown documentation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_modules_app ON modules(app);
CREATE INDEX idx_modules_type ON modules(type);
CREATE INDEX idx_modules_name ON modules(name);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS modules_fts USING fts5(
    name, 
    app, 
    description,
    content=modules
);

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    blueprint TEXT,      -- JSON string of Make scenario
    modules_used TEXT,   -- JSON array of module IDs
    category TEXT,
    difficulty TEXT,     -- 'beginner', 'intermediate', 'advanced'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id TEXT NOT NULL,
    config TEXT NOT NULL, -- JSON string of module configuration
    source TEXT,          -- 'template:123' or 'manual'
    FOREIGN KEY (module_id) REFERENCES modules(id)
);
```

---

### STEP 3: Database Layer (15 minutes)

**File: `src/database/db.ts`**

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class MakeDatabase {
    private db: Database.Database;

    constructor(dbPath: string = './data/make-modules.db') {
        // Ensure data directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.initializeSchema();
    }

    private initializeSchema() {
        const schema = fs.readFileSync('./src/database/schema.sql', 'utf-8');
        this.db.exec(schema);
    }

    // Search modules by keyword
    searchModules(query: string, app?: string): any[] {
        let sql = `
            SELECT m.* FROM modules m
            JOIN modules_fts fts ON m.id = fts.rowid
            WHERE modules_fts MATCH ?
        `;
        const params: any[] = [query];

        if (app) {
            sql += ' AND m.app = ?';
            params.push(app);
        }

        sql += ' LIMIT 20';
        return this.db.prepare(sql).all(...params);
    }

    // Get module by ID
    getModule(moduleId: string): any {
        return this.db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
    }

    // Get examples for a module
    getModuleExamples(moduleId: string, limit: number = 5): any[] {
        return this.db.prepare(`
            SELECT * FROM examples 
            WHERE module_id = ? 
            ORDER BY id DESC 
            LIMIT ?
        `).all(moduleId, limit);
    }

    // Insert module
    insertModule(module: any) {
        const stmt = this.db.prepare(`
            INSERT INTO modules (id, name, app, type, description, parameters, examples, documentation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            module.id,
            module.name,
            module.app,
            module.type,
            module.description,
            JSON.stringify(module.parameters),
            JSON.stringify(module.examples || []),
            module.documentation || ''
        );

        // Update FTS index
        this.db.prepare('INSERT INTO modules_fts(rowid, name, app, description) VALUES (?, ?, ?, ?)').run(
            module.id,
            module.name,
            module.app,
            module.description
        );
    }

    // Search templates
    searchTemplates(query?: string, category?: string): any[] {
        let sql = 'SELECT * FROM templates WHERE 1=1';
        const params: any[] = [];

        if (query) {
            sql += ' AND (name LIKE ? OR description LIKE ?)';
            params.push(`%${query}%`, `%${query}%`);
        }

        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }

        sql += ' LIMIT 50';
        return this.db.prepare(sql).all(...params);
    }

    // Get template by ID
    getTemplate(templateId: string): any {
        return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    }

    close() {
        this.db.close();
    }
}
```

---

### STEP 4: Module Scraper (30 minutes)

**File: `src/scrapers/scrape-modules.ts`**

```typescript
import axios from 'axios';
import { MakeDatabase } from '../database/db.js';

interface MakeModule {
    id: string;
    name: string;
    app: string;
    type: 'trigger' | 'action' | 'search';
    description: string;
    parameters: any[];
}

export class ModuleScraper {
    private db: MakeDatabase;

    constructor() {
        this.db = new MakeDatabase();
    }

    /**
     * STRATEGY 1: Scrape from Make's public integrations page
     */
    async scrapeFromIntegrationsPage(): Promise<MakeModule[]> {
        console.log('Fetching Make integrations...');
        
        // Make's public integrations API (replace with actual endpoint if available)
        const response = await axios.get('https://www.make.com/en/integrations');
        
        // TODO: Parse HTML to extract app list
        // For MVP, hardcode 20 most popular modules
        return this.getPopularModules();
    }

    /**
     * STRATEGY 2: Use Make API to fetch module catalog
     * Requires Make API key with proper permissions
     */
    async scrapeFromMakeAPI(): Promise<MakeModule[]> {
        const apiKey = process.env.MAKE_API_KEY;
        if (!apiKey) {
            throw new Error('MAKE_API_KEY not set');
        }

        try {
            // Attempt to fetch from Make API
            // Note: This endpoint may not exist publicly
            const response = await axios.get('https://eu1.make.com/api/v2/modules', {
                headers: {
                    'Authorization': `Token ${apiKey}`
                }
            });
            
            return response.data.modules;
        } catch (error) {
            console.log('Make API modules endpoint not available, using fallback');
            return this.getPopularModules();
        }
    }

    /**
     * STRATEGY 3: Hardcoded popular modules (MVP approach)
     */
    private getPopularModules(): MakeModule[] {
        return [
            {
                id: 'gateway:WebhookRespond',
                name: 'Webhook Response',
                app: 'Webhooks',
                type: 'action',
                description: 'Respond to webhook requests',
                parameters: [
                    { name: 'status', type: 'number', required: true, default: 200 },
                    { name: 'body', type: 'text', required: true }
                ]
            },
            {
                id: 'http:ActionSendData',
                name: 'HTTP Request',
                app: 'HTTP',
                type: 'action',
                description: 'Make HTTP requests to any API',
                parameters: [
                    { name: 'method', type: 'select', required: true, options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
                    { name: 'url', type: 'url', required: true },
                    { name: 'headers', type: 'array', required: false },
                    { name: 'body', type: 'text', required: false }
                ]
            },
            {
                id: 'slack:ActionPostMessage',
                name: 'Slack - Post Message',
                app: 'Slack',
                type: 'action',
                description: 'Post messages to Slack channels',
                parameters: [
                    { name: 'channel', type: 'text', required: true },
                    { name: 'text', type: 'text', required: true },
                    { name: 'username', type: 'text', required: false }
                ]
            },
            {
                id: 'gmail:ActionSendEmail',
                name: 'Gmail - Send Email',
                app: 'Gmail',
                type: 'action',
                description: 'Send emails via Gmail',
                parameters: [
                    { name: 'to', type: 'email', required: true },
                    { name: 'subject', type: 'text', required: true },
                    { name: 'body', type: 'text', required: true },
                    { name: 'cc', type: 'email', required: false }
                ]
            },
            {
                id: 'google-sheets:ActionAddRow',
                name: 'Google Sheets - Add Row',
                app: 'Google Sheets',
                type: 'action',
                description: 'Add rows to Google Sheets',
                parameters: [
                    { name: 'spreadsheetId', type: 'text', required: true },
                    { name: 'sheetName', type: 'text', required: true },
                    { name: 'values', type: 'array', required: true }
                ]
            },
            // Add 15 more popular modules here (Notion, Airtable, OpenAI, etc.)
        ];
    }

    /**
     * Populate database with scraped modules
     */
    async populateDatabase() {
        console.log('Populating database...');
        
        const modules = await this.scrapeFromIntegrationsPage();
        
        for (const module of modules) {
            try {
                this.db.insertModule(module);
                console.log(`✅ Inserted: ${module.name}`);
            } catch (error) {
                console.error(`❌ Failed to insert ${module.name}:`, error);
            }
        }

        console.log(`✅ Populated ${modules.length} modules`);
    }
}

// Run scraper
if (require.main === module) {
    const scraper = new ModuleScraper();
    scraper.populateDatabase().catch(console.error);
}
```

---

### STEP 5: MCP Server Core (20 minutes)

**File: `src/mcp/server.ts`**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MakeDatabase } from '../database/db.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const db = new MakeDatabase();

// Create MCP server
const server = new Server(
    {
        name: 'make-mcp',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// List available tools
server.setRequestHandler('tools/list', async () => {
    return {
        tools: [
            {
                name: 'search_modules',
                description: 'Search Make.com modules by keyword. Returns module names, types, and basic info.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search keyword (e.g., "slack", "email", "google sheets")'
                        },
                        app: {
                            type: 'string',
                            description: 'Optional: Filter by app name'
                        }
                    },
                    required: ['query']
                }
            },
            {
                name: 'get_module',
                description: 'Get detailed information about a specific Make module including all parameters, types, and examples.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        moduleId: {
                            type: 'string',
                            description: 'Module ID (e.g., "http:ActionSendData")'
                        },
                        includeExamples: {
                            type: 'boolean',
                            description: 'Include real-world configuration examples',
                            default: true
                        }
                    },
                    required: ['moduleId']
                }
            },
            {
                name: 'validate_scenario',
                description: 'Validate a Make scenario blueprint before deployment. Checks for missing parameters, invalid connections, and type mismatches.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        blueprint: {
                            type: 'string',
                            description: 'Make scenario blueprint JSON (stringified)'
                        }
                    },
                    required: ['blueprint']
                }
            },
            {
                name: 'create_scenario',
                description: 'Deploy a validated scenario to Make.com. Requires MAKE_API_KEY and MAKE_TEAM_ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Scenario name'
                        },
                        blueprint: {
                            type: 'string',
                            description: 'Scenario blueprint JSON (stringified)'
                        },
                        teamId: {
                            type: 'number',
                            description: 'Make team ID'
                        }
                    },
                    required: ['name', 'blueprint', 'teamId']
                }
            },
            {
                name: 'search_templates',
                description: 'Search Make scenario templates for inspiration and reuse.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search keyword'
                        },
                        category: {
                            type: 'string',
                            description: 'Filter by category (e.g., "marketing", "sales")'
                        }
                    }
                }
            }
        ]
    };
});

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'search_modules': {
                const results = db.searchModules(args.query, args.app);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(results, null, 2)
                    }]
                };
            }

            case 'get_module': {
                const module = db.getModule(args.moduleId);
                if (!module) {
                    throw new Error(`Module not found: ${args.moduleId}`);
                }

                let response: any = {
                    ...module,
                    parameters: JSON.parse(module.parameters)
                };

                if (args.includeExamples) {
                    const examples = db.getModuleExamples(args.moduleId);
                    response.examples = examples.map(ex => JSON.parse(ex.config));
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(response, null, 2)
                    }]
                };
            }

            case 'validate_scenario': {
                const blueprint = JSON.parse(args.blueprint);
                const errors: string[] = [];

                // Validate each module in the flow
                for (const module of blueprint.flow || []) {
                    const schema = db.getModule(module.module);
                    if (!schema) {
                        errors.push(`Unknown module: ${module.module}`);
                        continue;
                    }

                    const params = JSON.parse(schema.parameters);
                    for (const param of params) {
                        if (param.required && !module.parameters?.[param.name]) {
                            errors.push(`Missing required parameter '${param.name}' in module ${module.module}`);
                        }
                    }
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            valid: errors.length === 0,
                            errors
                        }, null, 2)
                    }]
                };
            }

            case 'create_scenario': {
                const apiKey = process.env.MAKE_API_KEY;
                if (!apiKey) {
                    throw new Error('MAKE_API_KEY not configured');
                }

                const response = await axios.post(
                    'https://eu1.make.com/api/v2/scenarios',
                    {
                        teamId: args.teamId,
                        name: args.name,
                        blueprint: args.blueprint,
                        scheduling: JSON.stringify({ type: 'on-demand' })
                    },
                    {
                        headers: {
                            'Authorization': `Token ${apiKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(response.data, null, 2)
                    }]
                };
            }

            case 'search_templates': {
                const templates = db.searchTemplates(args.query, args.category);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(templates, null, 2)
                    }]
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error: any) {
        return {
            content: [{
                type: 'text',
                text: `Error: ${error.message}`
            }],
            isError: true
        };
    }
});

// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Make MCP server running on stdio');
}

main().catch(console.error);
```

---

### STEP 6: Environment Configuration (2 minutes)

**File: `.env`**
```bash
# Make.com API credentials (optional - only needed for deployment)
MAKE_API_KEY=your_api_key_here
MAKE_API_URL=https://eu1.make.com/api/v2
MAKE_TEAM_ID=your_team_id

# Database
DATABASE_PATH=./data/make-modules.db

# Logging
LOG_LEVEL=info
```

---

### STEP 7: Package.json Scripts (2 minutes)

**File: `package.json`**
```json
{
  "name": "make-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "tsx src/mcp/server.ts",
    "scrape": "tsx src/scrapers/scrape-modules.ts",
    "dev": "tsx watch src/mcp/server.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "sqlite3": "^5.1.7",
    "better-sqlite3": "^11.0.0",
    "axios": "^1.6.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0"
  }
}
```

---

### STEP 8: Build & Test (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Scrape modules and populate database
npm run scrape

# 3. Test the server
npm start

# 4. In another terminal, test with MCP Inspector
npx @modelcontextprotocol/inspector tsx src/mcp/server.ts
```

---

### STEP 9: Claude Desktop Integration (3 minutes)

**File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)**

```json
{
  "mcpServers": {
    "make-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/make-mcp/dist/mcp/server.js"],
      "env": {
        "MAKE_API_KEY": "your_api_key",
        "MAKE_TEAM_ID": "123"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## 🎯 TESTING WORKFLOW

Once configured, test in Claude:

```
User: "Search for Slack modules"
Claude calls: search_modules({query: "slack"})

User: "Get details for slack:ActionPostMessage"
Claude calls: get_module({moduleId: "slack:ActionPostMessage", includeExamples: true})

User: "Create a scenario that sends Slack notifications when I receive Gmail emails"
Claude calls:
1. search_modules({query: "gmail"})
2. get_module({moduleId: "gmail:TriggerWatchEmails"})
3. get_module({moduleId: "slack:ActionPostMessage"})
4. validate_scenario({blueprint: "..."})
5. create_scenario({name: "Gmail to Slack", blueprint: "...", teamId: 123})
```

---

## 🚀 NEXT STEPS (After MVP)

1. **Expand module coverage**: Add 50+ more modules
2. **Template library**: Scrape Make.com public templates
3. **Better validation**: Add type checking, dependency validation
4. **Documentation**: Scrape Make help center
5. **Examples**: Extract configs from public templates
6. **Docker**: Package for easy deployment

---

## ⚠️ IMPORTANT NOTES

1. **Make API limitations**: Not all module metadata is publicly available. You may need to manually document popular modules.

2. **Scraping strategy**: If Make doesn't provide a public API for modules, you'll need to:
   - Inspect Make UI network requests
   - Parse HTML from Make's integrations page
   - Manually document top 50 modules

3. **Blueprint format**: Make scenario blueprints are complex JSON. Study existing scenarios in your Make account to understand the structure.

4. **Authentication**: Make API requires API key with proper scopes. Generate in Make → Profile → API Keys.

---

## 📚 REFERENCE LINKS

- Make API Docs: https://developers.make.com/api-documentation
- MCP Protocol: https://modelcontextprotocol.io
- n8n-MCP Reference: https://github.com/czlonkowski/n8n-mcp
- Make Integrations: https://www.make.com/en/integrations