# make-mcp

MCP server for creating, validating, and deploying [Make.com](https://www.make.com/) automation scenarios through AI assistants like Claude, Copilot, and other MCP-compatible clients.

## Features

- **🔍 200+ Modules** — Full-text search across 200+ Make.com modules (Slack, Gmail, Google Sheets, Notion, OpenAI, and 35+ more apps)
- **📋 Module Details** — Retrieve parameters, types, descriptions, and usage docs for any module
- **✅ Blueprint Validation** — Check scenarios for missing parameters, unknown modules, and structural issues before deploying
- **🚀 Deploy to Make.com** — Push validated blueprints directly to Make.com via API
- **📚 Scenario Templates** — Browse reusable scenario templates for common workflows
- **📖 Guided Prompts** — MCP prompts for guided scenario building and module exploration
- **📊 Resource Catalog** — MCP resources for browsing available apps
- **🧪 42 Tests** — Unit + integration test suite with Vitest

## Quick Start

### 1. Install & build

```bash
git clone <repo-url>
cd make-mcp
npm install
npm run build
```

### 2. Populate the module database

```bash
npm run scrape
```

### 3. Configure environment (optional — only needed for deployment)

```bash
cp .env.example .env
# Edit .env with your Make.com API credentials
```

### 4. Start the MCP server

```bash
npm start
```

## Claude Desktop Integration

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "make-mcp": {
      "command": "node",
      "args": ["/path/to/make-mcp/dist/mcp/server.js"],
      "env": {
        "MAKE_API_KEY": "your_api_key_here",
        "MAKE_TEAM_ID": "your_team_id",
        "LOG_LEVEL": "error"
      }
    }
  }
}
```

Or using the CLI:

```json
{
  "mcpServers": {
    "make-mcp": {
      "command": "/path/to/make-mcp/bin/make-mcp.js",
      "env": {
        "MAKE_API_KEY": "your_api_key_here",
        "MAKE_TEAM_ID": "your_team_id"
      }
    }
  }
}
```

Then ask Claude things like:

> "Create a Make scenario that watches a Slack channel for new messages and logs them to a Google Sheet"

> "What modules does Make have for sending emails?"

> "Validate this scenario blueprint..."

**Tip:** Start by calling `tools_documentation` to get a complete guide on how to use the server.

## Available Tools

| Tool | Description |
|------|-------------|
| `tools_documentation` | **START HERE** — Returns comprehensive documentation for all tools, prompts, and resources |
| `search_modules` | Full-text search across 200+ Make.com modules |
| `get_module` | Get detailed module info with parameters and docs |
| `validate_scenario` | Validate a scenario blueprint before deployment |
| `create_scenario` | Deploy a scenario to Make.com via API |
| `search_templates` | Search reusable scenario templates |
| `list_apps` | List all apps with module counts |

## MCP Prompts

| Prompt | Description |
|--------|-------------|
| `build_scenario` | Guided workflow for creating a Make.com scenario from a natural language description |
| `explain_module` | Get a detailed explanation of any Make.com module with usage examples |

## MCP Resources

| Resource URI | Description |
|-------------|-------------|
| `make://apps` | List of all available apps with module counts |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAKE_API_KEY` | For deployment | — | Make.com API key |
| `MAKE_API_URL` | No | `https://eu1.make.com/api/v2` | Make.com API base URL |
| `MAKE_TEAM_ID` | For deployment | — | Default team ID for scenario deployment |
| `DATABASE_PATH` | No | `./data/make-modules.db` | SQLite database file path |
| `LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error`, `silent` |

## Development

```bash
npm run start:dev   # Start with tsx (no build needed)
npm run dev         # Start with file watching
npm run build       # Compile TypeScript
npm run scrape      # Re-populate module database
npm test            # Run all 42 tests
npm run test:watch  # Run tests in watch mode
```

## Testing

The test suite includes 42 tests across 3 files:

- **Database tests** (14 tests) — Insert, search, template operations, FTS5 queries
- **Logger tests** (7 tests) — Stderr-only output, log levels, data serialization
- **Server integration tests** (21 tests) — Full MCP protocol compliance via SDK client

```bash
npm test
```

## Architecture

```
src/
├── mcp/
│   └── server.ts          # MCP server with tools, prompts, resources
├── database/
│   ├── schema.sql         # SQLite + FTS5 schema
│   └── db.ts              # Database access layer
├── scrapers/
│   └── scrape-modules.ts  # Module data population (224 modules)
└── utils/
    └── logger.ts          # Structured stderr logger
bin/
├── make-mcp.js            # CLI entry point
└── postinstall.js         # Post-install setup
tests/
├── database.test.ts       # Database unit tests
├── logger.test.ts         # Logger unit tests
└── server.test.ts         # MCP integration tests
data/
└── make-modules.db        # SQLite database (generated)
```

## Tech Stack

- **TypeScript** + **Node.js** (ESM)
- **@modelcontextprotocol/sdk** v1.26.0 — MCP protocol implementation
- **better-sqlite3** — Synchronous SQLite with FTS5 full-text search
- **zod** — Schema validation for tool parameters
- **axios** — HTTP client for Make.com API
- **vitest** — Test framework

## Supported Apps (40+)

Google Sheets, Slack, OpenAI, Google Drive, Notion, Telegram Bot, HubSpot CRM, Gmail, Airtable, Tools, Flow Control, Google Calendar, Jira, Trello, Shopify, Google Docs, Microsoft Teams, Microsoft Outlook, Discord, Asana, monday.com, Salesforce, Stripe, GitHub, HTTP, Mailchimp, WordPress, Dropbox, Data Store, JSON, Twilio, Google Gemini AI, WhatsApp Business, Text Parser, Webhooks, Anthropic Claude, CSV, RSS, Email, Schedule

## License

MIT
