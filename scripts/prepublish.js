#!/usr/bin/env node

/**
 * Prepublish script — builds the database so it's included in the npm package.
 *
 * Steps:
 *  1. Run the full build (compile + copy schema + shebang)
 *  2. Run the scraper to populate data/make-modules.db
 *  3. Verify the database was created and has data
 *
 * This ensures that `npx make-mcp-server` works immediately without any setup.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'make-modules.db');

console.log('📦  Preparing package for publish...\n');

// Step 1: Full build
console.log('1️⃣  Building...');
execSync('node scripts/build.js', { cwd: ROOT, stdio: 'inherit' });

// Step 2: Run scraper to populate database
console.log('\n2️⃣  Populating module database...');
execSync('node dist/scrapers/scrape-modules.js', { cwd: ROOT, stdio: 'inherit' });

// Step 3: Verify
if (!fs.existsSync(DB_PATH)) {
    console.error('❌  Database not found at', DB_PATH);
    process.exit(1);
}

const stats = fs.statSync(DB_PATH);
console.log(`\n✅  Database ready: ${(stats.size / 1024).toFixed(1)} KB`);
console.log('📦  Package is ready for npm publish!');
