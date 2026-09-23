/**
 * Minimal leveled logger with the plugin-wide `[gateway.catalog]` prefix.
 *
 * Safety rules:
 *  - API keys / Authorization headers are never logged.
 *  - All string values are sanitized (control characters removed) before output.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
    readonly level: LogLevel;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
/** Removes control characters (including ANSI escapes) from untrusted strings. */
export declare function sanitizeForLog(value: string): string;
export interface LoggerOptions {
    readonly level?: LogLevel;
    /** Test hook: receives already formatted lines. Defaults to console. */
    readonly sink?: (level: LogLevel, line: string) => void;
}
export declare function createLogger(options?: LoggerOptions): Logger;
export declare function parseLogLevel(value: unknown): LogLevel | undefined;
//# sourceMappingURL=logger.d.ts.map