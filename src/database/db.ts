import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to the package root (works with npx, global install, local)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From src/database/ or dist/database/ → package root
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Resolve the database path.
 *  - Explicit path → use as-is
 *  - Default       → <packageRoot>/data/make-modules.db
 */
function resolveDbPath(dbPath?: string): string {
    if (dbPath && dbPath !== './data/make-modules.db') {
        return path.resolve(dbPath);
    }
    return path.join(PACKAGE_ROOT, 'data', 'make-modules.db');
}

/**
 * Locate schema.sql — check src/ first (dev), then fall back to dist/ (npm package).
 */
function resolveSchemaPath(): string {
    const srcPath = path.join(PACKAGE_ROOT, 'src', 'database', 'schema.sql');
    if (fs.existsSync(srcPath)) return srcPath;

    // Bundled fallback: schema.sql shipped alongside compiled JS
    const distPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(distPath)) return distPath;

    throw new Error(
        `schema.sql not found. Searched:\n  - ${srcPath}\n  - ${distPath}`
    );
}

export class MakeDatabase {
    private db: Database.Database;

    constructor(dbPath?: string) {
        const resolved = resolveDbPath(dbPath);
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(resolved);
        this.db.pragma('journal_mode = WAL');
        this.initializeSchema();
    }

    private initializeSchema() {
        const schemaPath = resolveSchemaPath();
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        this.db.exec(schema);
    }

    searchModules(query: string, app?: string): any[] {
        // Handle "list all" wildcard case
        if (query === '*') {
            let sql = 'SELECT * FROM modules';
            const params: any[] = [];
            if (app) {
                sql += ' WHERE app = ?';
                params.push(app);
            }
            sql += ' ORDER BY app, name LIMIT 500';
            return this.db.prepare(sql).all(...params);
        }

        // Use FTS5 search with the standalone FTS table
        let sql = `
            SELECT m.* FROM modules m
            WHERE m.id IN (
                SELECT module_id FROM modules_fts WHERE modules_fts MATCH ?
            )
        `;
        const params: any[] = [query];

        if (app) {
            sql += ' AND m.app = ?';
            params.push(app);
        }

        sql += ' LIMIT 20';
        return this.db.prepare(sql).all(...params);
    }

    getModule(moduleId: string): any {
        return this.db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
    }

    getModuleExamples(moduleId: string, limit: number = 5): any[] {
        return this.db.prepare(`
            SELECT * FROM examples 
            WHERE module_id = ? 
            ORDER BY id DESC 
            LIMIT ?
        `).all(moduleId, limit);
    }

    insertModule(module: any) {
        // Use INSERT OR REPLACE so re-runs don't fail
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO modules (id, name, app, type, description, parameters, examples, documentation)
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

        // Delete old FTS entry if exists, then insert new one
        this.db.prepare('DELETE FROM modules_fts WHERE module_id = ?').run(module.id);
        this.db.prepare('INSERT INTO modules_fts(module_id, name, app, description) VALUES (?, ?, ?, ?)').run(
            module.id,
            module.name,
            module.app,
            module.description
        );
    }

    insertModules(modules: any[]) {
        const insertMany = this.db.transaction((mods: any[]) => {
            for (const mod of mods) {
                this.insertModule(mod);
            }
        });
        insertMany(modules);
    }

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

    getTemplate(templateId: string): any {
        return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    }

    insertTemplate(template: any) {
        this.db.prepare(`
            INSERT OR REPLACE INTO templates (id, name, description, blueprint, modules_used, category, difficulty)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            template.id,
            template.name,
            template.description,
            JSON.stringify(template.blueprint),
            JSON.stringify(template.modules_used || []),
            template.category || 'general',
            template.difficulty || 'beginner'
        );
    }

    close() {
        this.db.close();
    }
}
