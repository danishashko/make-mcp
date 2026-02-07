#!/usr/bin/env node

/**
 * make-mcp CLI entry point
 *
 * Usage:
 *   npx make-mcp                    — Start MCP server on stdio
 *   npx make-mcp --scrape           — Populate/refresh the module database
 *   npx make-mcp --version          — Print version
 *   npx make-mcp --help             — Show help
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    process.stderr.write(`make-mcp v${pkg.version}\n`);
    process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
    process.stderr.write(`
make-mcp — MCP server for Make.com automation scenarios

Usage:
  make-mcp              Start the MCP server (stdio transport)
  make-mcp --scrape     Populate/refresh the module database
  make-mcp --version    Print version
  make-mcp --help       Show this help

Environment Variables:
  MAKE_API_KEY          Make.com API key (required for deployment)
  MAKE_API_URL          Make.com API base URL (default: https://eu1.make.com/api/v2)
  MAKE_TEAM_ID          Default team ID for scenario deployment
  DATABASE_PATH         SQLite database path (default: ./data/make-modules.db)
  LOG_LEVEL             Logging level: debug, info, warn, error, silent (default: info)

Claude Desktop Config:
  {
    "mcpServers": {
      "make-mcp": {
        "command": "npx",
        "args": ["make-mcp"],
        "env": {
          "MAKE_API_KEY": "your_api_key_here",
          "MAKE_TEAM_ID": "your_team_id"
        }
      }
    }
  }
`);
    process.exit(0);
}

if (args.includes('--scrape')) {
    // Dynamic import of scraper
    const scraperPath = path.join(__dirname, '..', 'dist', 'scrapers', 'scrape-modules.js');
    if (!fs.existsSync(scraperPath)) {
        process.stderr.write('Error: Build the project first with `npm run build`\n');
        process.exit(1);
    }
    await import(pathToFileURL(scraperPath).href);
} else {
    // Start MCP server
    const serverPath = path.join(__dirname, '..', 'dist', 'mcp', 'server.js');
    if (!fs.existsSync(serverPath)) {
        process.stderr.write('Error: Build the project first with `npm run build`\n');
        process.exit(1);
    }
    await import(pathToFileURL(serverPath).href);
}
