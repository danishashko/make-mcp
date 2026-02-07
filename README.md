# make-mcp-server

[![npm version](https://img.shields.io/npm/v/make-mcp-server)](https://www.npmjs.com/package/make-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that provides AI assistants with comprehensive access to Make.com module documentation, scenario building, and deployment. Deploy in minutes to give Claude, Copilot, and other AI assistants deep knowledge about Make.com's 200+ automation modules across 40+ apps.

## Features

- **🔍 200+ Modules** — Full-text search across 200+ Make.com modules (Slack, Gmail, Google Sheets, Notion, OpenAI, and 35+ more apps)
- **📋 Module Details** — Retrieve parameters, types, descriptions, and usage docs for any module
- **✅ Blueprint Validation** — Check scenarios for missing parameters, unknown modules, structural issues, and router sub-routes before deploying
- **🚀 Deploy to Make.com** — Push validated blueprints directly to Make.com via API
- **🩹 Auto-Healing** — Automatically fixes LLM-generated blueprints: injects missing `metadata`, adds `designer` coordinates, strips unsupported properties like router `filter`
- **🔀 Router Support** — Full support for `builtin:BasicRouter` with multiple routes and recursive validation
- **📚 Scenario Templates** — Browse reusable scenario templates for common workflows
- **📖 Guided Prompts** — MCP prompts for guided scenario building and module exploration
- **📊 Resource Catalog** — MCP resources for browsing available apps
- **🧪 42 Tests** — Unit + integration test suite with Vitest
- **⚡ Fast Response** — Optimized SQLite with FTS5 full-text search

---

## 🚀 Quick Start — Self-Hosting Options

### Option A: npx (No Installation Needed!) 🚀

The fastest way to get started — no cloning, no building:

**Prerequisites:** [Node.js](https://nodejs.org/) installed on your system

```bash
# Run directly — no installation needed!
npx make-mcp-server
```

The package includes a pre-built database with all 200+ Make.com modules. Just add it to your MCP client config and go.

**Claude Desktop config** (`claude_desktop_config.json`):

Basic configuration (documentation tools only):

```json
{
  "mcpServers": {
    "make-mcp-server": {
      "command": "npx",
      "args": ["make-mcp-server"],
      "env": {
        "LOG_LEVEL": "error"
      }
    }
  }
}
```

Full configuration (with Make.com deployment):

```json
{
  "mcpServers": {
    "make-mcp-server": {
      "command": "npx",
      "args": ["make-mcp-server"],
      "env": {
        "LOG_LEVEL": "error",
        "MAKE_API_KEY": "your_api_key_here",
        "MAKE_TEAM_ID": "your_team_id",
        "MAKE_API_URL": "https://eu1.make.com/api/v2"
      }
    }
  }
}
```

> **Note:** npx will download and cache the latest version automatically. The package includes a pre-built database with all Make.com module information — no setup required.

---

### Option B: Docker (Isolated & Reproducible) 🐳

**Prerequisites:** Docker installed on your system

```bash
# Build the Docker image
docker build -t make-mcp-server .

# Test it works
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}},"id":1}' | docker run -i --rm make-mcp-server
```

**Claude Desktop config:**

Basic configuration (documentation tools only):

```json
{
  "mcpServers": {
    "make-mcp-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "--init",
        "-e", "LOG_LEVEL=error",
        "make-mcp-server"
      ]
    }
  }
}
```

Full configuration (with Make.com deployment):

```json
{
  "mcpServers": {
    "make-mcp-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "--init",
        "-e", "LOG_LEVEL=error",
        "-e", "MAKE_API_KEY=your_api_key_here",
        "-e", "MAKE_TEAM_ID=your_team_id",
        "-e", "MAKE_API_URL=https://eu1.make.com/api/v2",
        "make-mcp-server"
      ]
    }
  }
}
```

> **Important:** The `-i` flag is required for MCP stdio communication.

---

### Option C: Local Installation (For Development) 🛠️

**Prerequisites:** [Node.js](https://nodejs.org/) and Git

```bash
# 1. Clone and install
git clone https://github.com/danishashko/make-mcp.git
cd make-mcp
npm install

# 2. Build
npm run build

# 3. Populate the module database (already done if using npm package)
npm run scrape:prod

# 4. Test it works
npm start
```

**Claude Desktop config:**

```json
{
  "mcpServers": {
    "make-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/make-mcp/dist/mcp/server.js"],
      "env": {
        "LOG_LEVEL": "error",
        "MAKE_API_KEY": "your_api_key_here",
        "MAKE_TEAM_ID": "your_team_id"
      }
    }
  }
}
```

> **Note:** The Make.com API credentials are optional. Without them, you'll have access to all documentation, search, and validation tools. With them, you'll additionally get scenario deployment capabilities.

---

### Configuration File Locations

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

**Restart Claude Desktop after updating configuration.**

---

### 💻 Connect Your IDE

make-mcp-server works with any MCP-compatible client:

- **Claude Desktop** — See configurations above
- **VS Code (GitHub Copilot)** — Add to `.vscode/mcp.json`
- **Cursor** — Add to MCP settings
- **Claude Code** — Use `claude mcp add` command
- **Windsurf** — Add to MCP configuration

---

## Usage

Then ask your AI assistant things like:

> "Create a Make scenario that watches a Slack channel for new messages and logs them to a Google Sheet"

> "What modules does Make have for sending emails?"

> "Validate this scenario blueprint..."

**Tip:** The AI will automatically call `tools_documentation` first to understand how to use the server effectively.

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

## Auto-Healing

The `create_scenario` tool automatically fixes common issues in LLM-generated blueprints:

| Issue | Auto-Fix |
|-------|----------|
| Missing `metadata` section | Injects full metadata with `version`, `scenario` config, and `designer` |
| Missing `metadata.designer` on modules | Adds `{ x: 0, y: 0 }` coordinates |
| Router `filter` in route objects | Strips unsupported `filter` property (configure filters in Make.com UI) |
| Missing `version` on modules | Left unset — Make.com auto-resolves the latest installed version |

> **Tip:** Do NOT hardcode `"version": 1` on modules. Some apps (e.g., HTTP) are on v4+ and specifying the wrong version causes "Module not found" errors.

## MCP Prompts

| Prompt | Description |
|--------|-------------|
| `build_scenario` | Guided workflow for creating a Make.com scenario from a natural language description |
| `explain_module` | Get a detailed explanation of any Make.com module with usage examples |

## MCP Resources

| Resource URI | Description |
|-------------|-------------|
| `make://apps` | List of all available apps with module counts |

## CLI Usage

```bash
make-mcp-server              # Start the MCP server (stdio transport)
make-mcp-server --scrape     # Populate/refresh the module database
make-mcp-server --version    # Print version
make-mcp-server --help       # Show help
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAKE_API_KEY` | For deployment | — | Make.com API key |
| `MAKE_API_URL` | No | `https://eu1.make.com/api/v2` | Make.com API base URL |
| `MAKE_TEAM_ID` | For deployment | — | Default team ID for scenario deployment |
| `DATABASE_PATH` | No | `<package>/data/make-modules.db` | SQLite database file path |
| `LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error`, `silent` |

## Development

```bash
npm run build         # Compile TypeScript + copy schema + add shebang
npm run build:tsc     # TypeScript only (no packaging)
npm run start:dev     # Start with tsx (no build needed)
npm run dev           # Start with file watching
npm run scrape        # Populate DB with tsx (dev)
npm run scrape:prod   # Populate DB from compiled JS
npm test              # Run all 42 tests
npm run test:watch    # Run tests in watch mode
```

### Publishing to npm

```bash
npm run prepublishOnly   # Build + populate DB + verify (runs automatically on npm publish)
npm publish              # Publish to npm registry
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
│   └── db.ts              # Database access layer (npx-safe path resolution)
├── scrapers/
│   └── scrape-modules.ts  # Module data population (224 modules)
└── utils/
    └── logger.ts          # Structured stderr-only logger
bin/
├── make-mcp.js            # CLI entry point (npx, --help, --version, --scrape)
└── postinstall.js         # Post-install verification
scripts/
├── build.js               # Build: tsc + copy schema + add shebang
└── prepublish.js          # Publish prep: build + populate DB + verify
data/
└── make-modules.db        # Pre-built SQLite database (bundled in npm package)
tests/
├── database.test.ts       # Database unit tests (14)
├── logger.test.ts         # Logger unit tests (7)
└── server.test.ts         # MCP integration tests (21)
Dockerfile                 # Multi-stage Docker image
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

## Author

Built by **[Daniel Shashko](https://www.linkedin.com/in/daniel-shashko/)**

## License

MIT License — see [LICENSE](LICENSE) for details.
