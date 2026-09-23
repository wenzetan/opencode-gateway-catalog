/**
 * Structured error types for the gateway catalog plugin.
 *
 * The distinction between fatal (config) errors and recoverable runtime errors
 * matters: a temporarily unreachable gateway must never take down the OpenCode
 * server or mark the plugin as failed.
 */
export type ErrorCode = "CONFIG_ERROR" | "DISCOVERY_ERROR" | "AUTHENTICATION_ERROR" | "VALIDATION_ERROR" | "CATALOG_INTEGRITY_ERROR" | "CACHE_ERROR";
export type ErrorSeverity = "fatal" | "recoverable";
export declare class GatewayCatalogError extends Error {
    readonly code: ErrorCode;
    readonly severity: ErrorSeverity;
    /** Safe, non-secret detail that may be logged (never request headers or API keys). */
    readonly detail: string | undefined;
    constructor(code: ErrorCode, severity: ErrorSeverity, message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
/** Invalid plugin configuration. Fatal: the plugin refuses to activate. */
export declare class ConfigError extends GatewayCatalogError {
    constructor(message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
/** Transport level failure while talking to the gateway. Recoverable. */
export declare class DiscoveryError extends GatewayCatalogError {
    constructor(message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
/** The gateway rejected our credentials (HTTP 401/403). Recoverable at refresh time. */
export declare class AuthenticationError extends GatewayCatalogError {
    constructor(message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
/** The discovery payload could not be validated. Recoverable (keep last-known-good). */
export declare class ValidationError extends GatewayCatalogError {
    constructor(message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
/**
 * The catalog as a whole is untrustworthy (duplicate ids, missing ids, data not
 * an array). The whole refresh is rejected so a gateway bug cannot silently
 * corrupt the OpenCode catalog.
 */
export declare class CatalogIntegrityError extends GatewayCatalogError {
    constructor(message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
/** Reading or writing the persistent last-known-good cache failed. Recoverable. */
export declare class CacheError extends GatewayCatalogError {
    constructor(message: string, options?: {
        cause?: unknown;
        detail?: string;
    });
}
export declare function isGatewayCatalogError(error: unknown): error is GatewayCatalogError;
/** Returns a log-safe description of an error without headers, keys or stack noise. */
export declare function describeError(error: unknown): string;
//# sourceMappingURL=errors.d.ts.map