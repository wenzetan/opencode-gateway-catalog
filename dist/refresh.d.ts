/**
 * Catalog lifecycle: initial discovery, background refresh, last-known-good
 * behavior and single-flight concurrency.
 *
 * The transform callback registered with OpenCode only ever reads the
 * in-memory `CatalogState` produced here. All network and disk IO happens
 * outside of the transform callback.
 */
import type { Model } from "@opencode/plugin";
import type { GatewayAdapter, GatewayModel } from "./adapters/types.js";
import { DiskCache } from "./cache.js";
import type { ResolvedConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { type SkippedModel } from "./mapper.js";
export type CatalogSource = "live" | "cache" | "empty";
export interface CatalogState {
    readonly gatewayModels: readonly GatewayModel[];
    readonly models: readonly Model.Info[];
    readonly skipped: readonly SkippedModel[];
    readonly source: CatalogSource;
    readonly fetchedAt: string | undefined;
}
export interface RefreshDeps {
    readonly adapter: GatewayAdapter;
    readonly config: ResolvedConfig;
    readonly logger: Logger;
    readonly cache: DiskCache | undefined;
    readonly fetchImpl: typeof fetch;
    readonly now: () => Date;
    /** Called after a changed catalog was committed (typically `ctx.provider.reload`). */
    readonly onCatalogChanged: () => Promise<void>;
}
/** Deterministic comparison key: property order and gateway ordering do not matter. */
export declare function canonicalState(state: CatalogState): string;
export declare class CatalogController {
    private readonly deps;
    private readonly identity;
    private state;
    private inFlight;
    private disposed;
    private readonly abortControllers;
    constructor(deps: RefreshDeps);
    getState(): CatalogState;
    /** Initial load: live discovery, then disk cache, then an empty but valid catalog. */
    initialize(): Promise<void>;
    /** Single-flight refresh. Timer, manual and startup-refresh callers share one request. */
    refresh(reason: string): Promise<void>;
    dispose(): void;
    private doRefresh;
    private commit;
    private loadCandidate;
    /** Authorization headers are built at request time and never stored or logged. */
    private buildHeaders;
    private resolveApiKey;
    private persist;
    private restoreFromCache;
    private logSummary;
    private logSkips;
}
//# sourceMappingURL=refresh.d.ts.map