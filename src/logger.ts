/**
 * Minimal leveled logger with the plugin-wide `[gateway.catalog]` prefix.
 *
 * Safety rules:
 *  - API keys / Authorization headers are never logged.
 *  - All string values are sanitized (control characters removed) before output.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const PREFIX = "[gateway.catalog]";

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Removes control characters (including ANSI escapes) from untrusted strings. */
export function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "?");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return sanitizeForLog(value);
  if (value === null || value === undefined) return String(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Error) return sanitizeForLog(`${value.name}: ${value.message}`);
  try {
    return sanitizeForLog(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** Test hook: receives already formatted lines. Defaults to console. */
  readonly sink?: (level: LogLevel, line: string) => void;
}

function defaultSink(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const threshold = LEVEL_ORDER[level];
  const sink = options.sink ?? defaultSink;

  const emit = (entryLevel: LogLevel, message: string, args: unknown[]): void => {
    if (LEVEL_ORDER[entryLevel] < threshold) return;
    const suffix = args.length > 0 ? " " + args.map(formatValue).join(" ") : "";
    sink(entryLevel, `${PREFIX} ${sanitizeForLog(message)}${suffix}`);
  };

  return {
    level,
    debug: (message, ...args) => emit("debug", message, args),
    info: (message, ...args) => emit("info", message, args),
    warn: (message, ...args) => emit("warn", message, args),
    error: (message, ...args) => emit("error", message, args),
  };
}

export function parseLogLevel(value: unknown): LogLevel | undefined {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : undefined;
}
