/**
 * Postinstall script — verifies database exists.
 *
 * When installed from npm, the pre-built database is bundled in data/make-modules.db.
 * This script just ensures the data directory and DB file are present.
 * If missing (dev/clone scenario), it tells the user how to populate it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const dataDir = path.join(ROOT, 'data');
const dbPath = path.join(dataDir, 'make-modules.db');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    process.stderr.write(`[make-mcp] ✅ Database ready (${(stats.size / 1024).toFixed(0)} KB)\n`);
} else {
    process.stderr.write(
        '[make-mcp] ⚠️  Database not found. If you cloned from source, run:\n' +
        '  npm run build && npm run scrape:prod\n' +
        '  to populate the module database.\n'
    );
}
