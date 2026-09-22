/**
 * Structured error types for the gateway catalog plugin.
 *
 * The distinction between fatal (config) errors and recoverable runtime errors
 * matters: a temporarily unreachable gateway must never take down the OpenCode
 * server or mark the plugin as failed.
 */

export type ErrorCode =
  | "CONFIG_ERROR"
  | "DISCOVERY_ERROR"
  | "AUTHENTICATION_ERROR"
  | "VALIDATION_ERROR"
  | "CATALOG_INTEGRITY_ERROR"
  | "CACHE_ERROR";

export type ErrorSeverity = "fatal" | "recoverable";

export class GatewayCatalogError extends Error {
  readonly code: ErrorCode;
  readonly severity: ErrorSeverity;
  /** Safe, non-secret detail that may be logged (never request headers or API keys). */
  readonly detail: string | undefined;

  constructor(
    code: ErrorCode,
    severity: ErrorSeverity,
    message: string,
    options?: { cause?: unknown; detail?: string },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = code;
    this.code = code;
    this.severity = severity;
    this.detail = options?.detail;
  }
}

/** Invalid plugin configuration. Fatal: the plugin refuses to activate. */
export class ConfigError extends GatewayCatalogError {
  constructor(message: string, options?: { cause?: unknown; detail?: string }) {
    super("CONFIG_ERROR", "fatal", message, options);
  }
}

/** Transport level failure while talking to the gateway. Recoverable. */
export class DiscoveryError extends GatewayCatalogError {
  constructor(message: string, options?: { cause?: unknown; detail?: string }) {
    super("DISCOVERY_ERROR", "recoverable", message, options);
  }
}

/** The gateway rejected our credentials (HTTP 401/403). Recoverable at refresh time. */
export class AuthenticationError extends GatewayCatalogError {
  constructor(message: string, options?: { cause?: unknown; detail?: string }) {
    super("AUTHENTICATION_ERROR", "recoverable", message, options);
  }
}

/** The discovery payload could not be validated. Recoverable (keep last-known-good). */
export class ValidationError extends GatewayCatalogError {
  constructor(message: string, options?: { cause?: unknown; detail?: string }) {
    super("VALIDATION_ERROR", "recoverable", message, options);
  }
}

/**
 * The catalog as a whole is untrustworthy (duplicate ids, missing ids, data not
 * an array). The whole refresh is rejected so a gateway bug cannot silently
 * corrupt the OpenCode catalog.
 */
export class CatalogIntegrityError extends GatewayCatalogError {
  constructor(message: string, options?: { cause?: unknown; detail?: string }) {
    super("CATALOG_INTEGRITY_ERROR", "recoverable", message, options);
  }
}

/** Reading or writing the persistent last-known-good cache failed. Recoverable. */
export class CacheError extends GatewayCatalogError {
  constructor(message: string, options?: { cause?: unknown; detail?: string }) {
    super("CACHE_ERROR", "recoverable", message, options);
  }
}

export function isGatewayCatalogError(error: unknown): error is GatewayCatalogError {
  return error instanceof GatewayCatalogError;
}

/** Returns a log-safe description of an error without headers, keys or stack noise. */
export function describeError(error: unknown): string {
  if (isGatewayCatalogError(error)) {
    return error.detail
      ? `${error.name}: ${error.message} (${error.detail})`
      : `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
