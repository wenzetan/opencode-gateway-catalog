/**
 * Persistent last-known-good cache.
 *
 * Cache location: `$XDG_CACHE_HOME/opencode-gateway-catalog/` (falling back to
 * `~/.cache/opencode-gateway-catalog/`). The cache key covers adapter,
 * providerId and baseURL so that different gateways/environments never share a
 * catalog.
 *
 * The payload contains canonical `GatewayModel` entries only:
 *  - never API keys, Authorization headers or request headers
 *  - never the original `raw` gateway item
 */
import type { GatewayModel } from "./adapters/types.js";
import type { Logger } from "./logger.js";
export declare const CACHE_VERSION = 2;
export interface CacheIdentity {
    readonly adapter: string;
    readonly providerId: string;
    readonly baseURL: string;
}
export interface CacheEntry {
    readonly version: typeof CACHE_VERSION;
    readonly adapter: string;
    readonly providerId: string;
    readonly baseURL: string;
    readonly fetchedAt: string;
    readonly models: readonly GatewayModel[];
}
export declare function defaultCacheDir(): string;
export declare function cacheFileName(identity: CacheIdentity): string;
/**
 * Serializes canonical models for the cache. Kept separate so tests can assert
 * that no secret-like fields are persisted.
 */
export declare function serializeCachedModels(models: readonly GatewayModel[]): unknown[];
export interface CacheStoreOptions {
    readonly dir?: string;
    readonly logger: Logger;
}
export declare class DiskCache {
    private readonly dir;
    private readonly logger;
    constructor(options: CacheStoreOptions);
    get directory(): string;
    private pathFor;
    read(identity: CacheIdentity): Promise<CacheEntry | undefined>;
    write(identity: CacheIdentity, models: readonly GatewayModel[], fetchedAt: string): Promise<void>;
}
//# sourceMappingURL=cache.d.ts.map