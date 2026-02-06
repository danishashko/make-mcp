/**
 * Database unit tests
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MakeDatabase } from '../src/database/db.js';
import fs from 'fs';

const TEST_DB_PATH = './data/test-db.db';

describe('MakeDatabase', () => {
    let db: MakeDatabase;

    beforeAll(() => {
        db = new MakeDatabase(TEST_DB_PATH);
    });

    afterAll(() => {
        db.close();
        // Cleanup test database
        try {
            fs.unlinkSync(TEST_DB_PATH);
            fs.unlinkSync(TEST_DB_PATH + '-wal');
            fs.unlinkSync(TEST_DB_PATH + '-shm');
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('insertModule', () => {
        it('should insert a single module', () => {
            db.insertModule({
                id: 'test:Action1',
                name: 'Test Action 1',
                app: 'Test App',
                type: 'action',
                description: 'A test action module',
                parameters: [
                    { name: 'input', type: 'text', required: true, description: 'Input text' },
                ],
            });

            const mod = db.getModule('test:Action1');
            expect(mod).toBeDefined();
            expect(mod.name).toBe('Test Action 1');
            expect(mod.app).toBe('Test App');
            expect(mod.type).toBe('action');
        });

        it('should handle INSERT OR REPLACE gracefully', () => {
            db.insertModule({
                id: 'test:Action1',
                name: 'Test Action 1 Updated',
                app: 'Test App',
                type: 'action',
                description: 'Updated description',
                parameters: [],
            });

            const mod = db.getModule('test:Action1');
            expect(mod.name).toBe('Test Action 1 Updated');
            expect(mod.description).toBe('Updated description');
        });
    });

    describe('insertModules', () => {
        it('should insert multiple modules in a transaction', () => {
            const modules = [
                {
                    id: 'batch:Action1',
                    name: 'Batch 1',
                    app: 'BatchApp',
                    type: 'action' as const,
                    description: 'Batch action 1',
                    parameters: [],
                },
                {
                    id: 'batch:Action2',
                    name: 'Batch 2',
                    app: 'BatchApp',
                    type: 'trigger' as const,
                    description: 'Batch trigger 2',
                    parameters: [],
                },
                {
                    id: 'batch:Search1',
                    name: 'Batch Search',
                    app: 'BatchApp',
                    type: 'search' as const,
                    description: 'Batch search module',
                    parameters: [],
                },
            ];

            db.insertModules(modules);

            expect(db.getModule('batch:Action1')).toBeDefined();
            expect(db.getModule('batch:Action2')).toBeDefined();
            expect(db.getModule('batch:Search1')).toBeDefined();
        });
    });

    describe('searchModules', () => {
        it('should find modules by keyword', () => {
            const results = db.searchModules('batch');
            expect(results.length).toBeGreaterThanOrEqual(2);
        });

        it('should find modules with wildcard *', () => {
            const results = db.searchModules('*');
            expect(results.length).toBeGreaterThanOrEqual(4);
        });

        it('should filter by app name', () => {
            const results = db.searchModules('*', 'BatchApp');
            expect(results.length).toBe(3);
            expect(results.every((r: any) => r.app === 'BatchApp')).toBe(true);
        });

        it('should return empty array for no matches', () => {
            const results = db.searchModules('nonexistentxyz123');
            expect(results).toEqual([]);
        });
    });

    describe('getModule', () => {
        it('should return null for nonexistent module', () => {
            const mod = db.getModule('nonexistent:Module');
            expect(mod).toBeUndefined();
        });

        it('should return module with parseable parameters JSON', () => {
            const mod = db.getModule('test:Action1');
            expect(mod).toBeDefined();
            const params = JSON.parse(mod.parameters);
            expect(Array.isArray(params)).toBe(true);
        });
    });

    describe('templates', () => {
        it('should insert and retrieve a template', () => {
            db.insertTemplate({
                id: 'tpl-1',
                name: 'Test Template',
                description: 'A test template for slack notification',
                blueprint: { flow: [{ module: 'test:Action1' }] },
                modules_used: ['test:Action1'],
                category: 'testing',
                difficulty: 'beginner',
            });

            const tpl = db.getTemplate('tpl-1');
            expect(tpl).toBeDefined();
            expect(tpl.name).toBe('Test Template');
            expect(tpl.category).toBe('testing');
        });

        it('should search templates by query', () => {
            const results = db.searchTemplates('slack');
            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it('should search templates by category', () => {
            const results = db.searchTemplates(undefined, 'testing');
            expect(results.length).toBe(1);
        });

        it('should return empty for no matches', () => {
            const results = db.searchTemplates('zzzznonexistent');
            expect(results).toEqual([]);
        });
    });

    describe('getModuleExamples', () => {
        it('should return empty array when no examples exist', () => {
            const examples = db.getModuleExamples('test:Action1');
            expect(examples).toEqual([]);
        });
    });
});
