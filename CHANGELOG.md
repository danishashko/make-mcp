# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-02-07

### Added
- **Auto-healing** for LLM-generated blueprints — `create_scenario` now auto-injects missing `metadata`, `scenario` config, and `designer` coordinates
- **Router support** — Full `builtin:BasicRouter` deployment with multiple routes (tested & verified)
- **Recursive validation** — `validate_scenario` now traverses into router sub-routes
- **Router filter stripping** — Automatically removes unsupported `filter` property from route objects
- **Enhanced error reporting** — `create_scenario` returns full Make.com API error details including `suberrors`
- **`?confirmed=true`** query parameter on scenario creation to auto-install first-time apps
- 3 new tips in `tools_documentation` about versioning, filters, and auto-healing

### Changed
- Module `version` is no longer auto-injected — Make.com resolves the latest installed version automatically
- Removed false "missing version" warning from `validate_scenario`

### Fixed
- **HTTP module "Module not found"** — Caused by forcing `version: 1` on modules that have been updated (HTTP is now v4)
- **Router 400 Bad Request** — Caused by `filter` property being rejected as additional property on route objects
- **Workspace MCP config override** — `.vscode/mcp.json` was overriding global config; documented that all env vars must be present in workspace config

## [1.2.0] - 2026-02-07

### Added
- **npx support** — `npx make-mcp-server` runs zero-install with pre-built database
- **Docker support** — Multi-stage Dockerfile for isolated deployments
- **CLI entry point** — `make-mcp-server --help`, `--version`, `--scrape` flags
- **Self-hosting options** in README (npx, Docker, local dev)
- **Build script** (`scripts/build.js`) — tsc + copy schema.sql + add shebang
- **Prepublish script** (`scripts/prepublish.js`) — automated package preparation
- **Path resolution** — All paths resolve relative to package root (works from any cwd)
- `.dockerignore` for lean Docker builds
- `.env.example` template

### Changed
- `db.ts` now uses `import.meta.url` for path resolution (npx/global-install safe)
- `package.json` `bin` entry, `files` whitelist, and `scripts` updated for npm distribution
- `postinstall.js` improved with clearer messaging
- README completely rewritten with self-hosting options and IDE setup guides

### Fixed
- Windows ESM `import()` error — use `pathToFileURL()` in CLI entry point
- Schema.sql not found when running from different working directory

## [1.1.0] - 2026-02-06

### Added
- **Production hardening** — migrated to `registerTool`/`registerPrompt`/`registerResource` (SDK v1.26.0)
- **Structured logger** (`src/utils/logger.ts`) — stderr-only, LOG_LEVEL support
- **MCP Prompts** — `build_scenario` (guided creation), `explain_module`
- **MCP Resources** — `make://apps` (apps catalog)
- **`tools_documentation`** meta-tool (START HERE pattern)
- **Tool annotations** — `destructiveHint`/`idempotentHint` on `create_scenario`
- **Input sanitization** on all tool inputs
- **Graceful shutdown** handlers (SIGINT, SIGTERM, uncaughtException)
- **42 Vitest tests** — 14 database + 7 logger + 21 integration
- `isError` flag on all tool error responses

### Fixed
- FTS5 wildcard `*` search crash — added early return for "list all" case

## [1.0.0] - 2026-02-05

### Added
- Initial release
- 224 Make.com modules across 40+ apps
- 6 MCP tools: search_modules, get_module, validate_scenario, create_scenario, search_templates, list_apps
- SQLite database with FTS5 full-text search
- Make.com API integration for scenario deployment
- Module scraper with built-in catalog
