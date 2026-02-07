#!/usr/bin/env node

/**
 * Build script — extends tsc with additional packaging steps:
 *  1. Compile TypeScript
 *  2. Copy schema.sql to dist/database/ (for npx/global-install resolution)
 *  3. Prepend shebang to dist/mcp/server.js (for bin entry)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Step 1: Run TypeScript compiler
console.log('⚙️  Compiling TypeScript...');
try {
    execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });
} catch {
    process.exit(1);
}

// Step 2: Copy schema.sql to dist/database/
const schemaSrc = path.join(ROOT, 'src', 'database', 'schema.sql');
const schemaDst = path.join(ROOT, 'dist', 'database', 'schema.sql');
fs.copyFileSync(schemaSrc, schemaDst);
console.log('📄  Copied schema.sql → dist/database/');

// Step 3: Prepend shebang to the entry point for npx/bin usage
const entryFile = path.join(ROOT, 'dist', 'mcp', 'server.js');
const content = fs.readFileSync(entryFile, 'utf-8');
if (!content.startsWith('#!')) {
    fs.writeFileSync(entryFile, '#!/usr/bin/env node\n' + content);
    console.log('🔧  Added shebang to dist/mcp/server.js');
}

console.log('✅  Build complete!');
