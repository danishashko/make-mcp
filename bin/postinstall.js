/**
 * Postinstall script — ensures data directory exists and database is populated.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    process.stderr.write('[make-mcp] Created data directory\n');
}

const dbPath = path.join(dataDir, 'make-modules.db');
if (!fs.existsSync(dbPath)) {
    process.stderr.write('[make-mcp] Database not found. Run `npm run scrape` to populate the module database.\n');
}
