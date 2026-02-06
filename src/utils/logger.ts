/**
 * Structured logger for MCP server.
 *
 * CRITICAL: All output goes to stderr, NEVER stdout.
 * In stdio transport mode, stdout is the JSON-RPC channel.
 * Any non-JSON-RPC output on stdout breaks the protocol.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

let currentLevel: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info';

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(level: string, message: string, data?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (data && Object.keys(data).length > 0) {
        return `${base} ${JSON.stringify(data)}`;
    }
    return base;
}

export const logger = {
    debug(message: string, data?: Record<string, unknown>): void {
        if (shouldLog('debug')) {
            process.stderr.write(formatMessage('debug', message, data) + '\n');
        }
    },

    info(message: string, data?: Record<string, unknown>): void {
        if (shouldLog('info')) {
            process.stderr.write(formatMessage('info', message, data) + '\n');
        }
    },

    warn(message: string, data?: Record<string, unknown>): void {
        if (shouldLog('warn')) {
            process.stderr.write(formatMessage('warn', message, data) + '\n');
        }
    },

    error(message: string, data?: Record<string, unknown>): void {
        if (shouldLog('error')) {
            process.stderr.write(formatMessage('error', message, data) + '\n');
        }
    },
};
