/**
 * Logger unit tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger, setLogLevel, getLogLevel } from '../src/utils/logger.js';

describe('Logger', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        setLogLevel('debug');
    });

    it('should log to stderr, never stdout', () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        logger.info('test message');

        expect(stderrSpy).toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();

        stdoutSpy.mockRestore();
    });

    it('should include timestamp and level', () => {
        logger.info('hello world');

        const output = stderrSpy.mock.calls[0]?.[0] as string;
        expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
        expect(output).toContain('[INFO]');
        expect(output).toContain('hello world');
    });

    it('should include data when provided', () => {
        logger.info('with data', { key: 'value' });

        const output = stderrSpy.mock.calls[0]?.[0] as string;
        expect(output).toContain('"key":"value"');
    });

    it('should respect log level - suppress debug at info level', () => {
        setLogLevel('info');
        logger.debug('should not appear');

        expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should respect log level - show error at info level', () => {
        setLogLevel('info');
        logger.error('should appear');

        expect(stderrSpy).toHaveBeenCalled();
    });

    it('should suppress all at silent level', () => {
        setLogLevel('silent');
        logger.debug('no');
        logger.info('no');
        logger.warn('no');
        logger.error('no');

        expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should get/set log level', () => {
        setLogLevel('warn');
        expect(getLogLevel()).toBe('warn');
    });

    afterEach(() => {
        stderrSpy.mockRestore();
    });
});
