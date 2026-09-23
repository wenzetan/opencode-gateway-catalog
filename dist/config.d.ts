/**
 * Plugin option parsing, validation and URL derivation.
 *
 * URLs are derived with the WHATWG `URL` class (never string concatenation) so
 * that a gateway mounted under a path prefix such as
 * `https://gateway.example.com/prefix` keeps its prefix.
 */
import { type LogLevel } from "./logger.js";
export declare const DEFAULT_MAX_RESPONSE_BYTES: number;
export declare const DEFAULT_API_KEY_ENV = "OMNIROUTE_API_KEY";
export declare const DEFAULT_DISCOVERY_PATH = "/v1/models";
export declare const DEFAULT_REFRESH_INTERVAL_MS = 300000;
export declare const DEFAULT_TIMEOUT_MS = 10000;
export type AdapterId = "omniroute";
export interface PluginOptions {
    readonly adapter?: AdapterId;
    readonly providerId?: string;
    readonly providerName?: string;
    readonly baseURL: string;
    /** Explicit API key in configuration. Supported, but `apiKeyEnv` is the recommended mode. */
    readonly apiKey?: string;
    /** Environment variable holding the API key. Defaults to `OMNIROUTE_API_KEY`; `null` disables it. */
    readonly apiKeyEnv?: string | null;
    /** Discovery path relative to `baseURL`. Defaults to `<apiBaseURL>/models` (i.e. `/v1/models`). */
    readonly discoveryPath?: string;
    readonly refreshIntervalMs?: number;
    readonly timeoutMs?: number;
    readonly cache?: boolean;
    readonly strictMetadata?: boolean;
    /** Optional upper bound for discovery response bodies. Defaults to 16 MiB. */
    readonly maxResponseBytes?: number;
    /** Optional log level override; also readable from OPENCODE_GATEWAY_CATALOG_LOG_LEVEL. */
    readonly logLevel?: LogLevel;
}
export interface ResolvedConfig {
    readonly adapter: AdapterId;
    readonly providerId: string;
    readonly providerName: string;
    /** Normalized gateway root exactly as configured, without a trailing slash. */
    readonly gatewayRoot: string;
    /** Runtime base URL handed to `@opencode/ai/providers/openai-compatible`. */
    readonly apiBaseURL: string;
    /** Fully derived `GET` URL for the model catalog. */
    readonly discoveryURL: string;
    readonly discoveryPathLabel: string;
    /** Explicit key from configuration (never logged, never cached). */
    readonly apiKey: string | undefined;
    readonly apiKeyEnv: string | null;
    readonly refreshIntervalMs: number;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    readonly cache: boolean;
    readonly strictMetadata: boolean;
    readonly logLevel: LogLevel;
}
/** `http://host` -> `http://host/v1`; `http://host/prefix` -> `http://host/prefix/v1`. */
export declare function deriveApiBaseURL(gatewayRoot: URL): URL;
export interface ParsedConfig {
    readonly config: ResolvedConfig;
    readonly warnings: readonly string[];
}
export declare function parseConfig(rawOptions: unknown): ParsedConfig;
//# sourceMappingURL=config.d.ts.map