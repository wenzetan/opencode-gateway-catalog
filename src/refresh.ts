/**
 * Catalog lifecycle: initial discovery, background refresh, last-known-good
 * behavior and single-flight concurrency.
 *
 * The transform callback registered with OpenCode only ever reads the
 * in-memory `CatalogState` produced here. All network and disk IO happens
 * outside of the transform callback.
 */

import type { Model } from "@opencode/plugin";
import type { AdapterContext, GatewayAdapter, GatewayModel, ModelIssue } from "./adapters/types.js";
import { DiskCache, type CacheIdentity } from "./cache.js";
import type { ResolvedConfig } from "./config.js";
import { describeError } from "./errors.js";
import type { Logger } from "./logger.js";
import { mapGatewayCatalog, type SkippedModel } from "./mapper.js";

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

interface Candidate {
  readonly gatewayModels: readonly GatewayModel[];
  readonly models: readonly Model.Info[];
  readonly skipped: readonly SkippedModel[];
  readonly issues: readonly ModelIssue[];
}

function emptyState(): CatalogState {
  return { gatewayModels: [], models: [], skipped: [], source: "empty", fetchedAt: undefined };
}

function canonicalModel(model: Model.Info): unknown {
  return {
    id: String(model.id),
    modelID: String(model.modelID),
    providerID: String(model.providerID),
    name: model.name,
    family: model.family === undefined ? null : String(model.family),
    capabilities: {
      tools: model.capabilities.tools,
      input: [...model.capabilities.input],
      output: [...model.capabilities.output],
    },
    variants: model.variants.map((variant) => ({
      id: String(variant.id),
      settings: variant.settings ?? null,
      headers: variant.headers ?? null,
      body: variant.body ?? null,
    })),
    limit: {
      context: model.limit.context,
      input: model.limit.input ?? null,
      output: model.limit.output,
    },
    cost: model.cost.map((tier) => ({
      input: tier.input,
      output: tier.output,
      cache: { read: tier.cache.read, write: tier.cache.write },
    })),
    enabled: model.enabled,
    status: model.status,
  };
}

/** Deterministic comparison key: property order and gateway ordering do not matter. */
export function canonicalState(state: CatalogState): string {
  return JSON.stringify({
    models: state.models.map(canonicalModel),
    skipped: state.skipped.map((entry) => entry.id).sort(),
  });
}

export class CatalogController {
  private readonly deps: RefreshDeps;
  private readonly identity: CacheIdentity;
  private state: CatalogState = emptyState();
  private inFlight: Promise<void> | undefined;
  private disposed = false;
  private readonly abortControllers = new Set<AbortController>();

  constructor(deps: RefreshDeps) {
    this.deps = deps;
    this.identity = {
      adapter: deps.config.adapter,
      providerId: deps.config.providerId,
      baseURL: deps.config.apiBaseURL,
    };
  }

  getState(): CatalogState {
    return this.state;
  }

  /** Initial load: live discovery, then disk cache, then an empty but valid catalog. */
  async initialize(): Promise<void> {
    const { config, logger } = this.deps;
    logger.info(`provider=${config.providerId} discovering models from ${config.discoveryURL}`);
    try {
      const candidate = await this.loadCandidate();
      this.commit(candidate, "live", this.deps.now().toISOString());
      await this.persist(candidate.gatewayModels);
      this.logSummary("discovered");
      this.logSkips(candidate.skipped);
      return;
    } catch (error) {
      logger.warn(`provider=${config.providerId} discovery failed: ${describeError(error)}`);
    }

    const restored = await this.restoreFromCache();
    if (restored) return;

    this.state = emptyState();
    logger.warn(
      `provider=${config.providerId} has no models: gateway unreachable and no cached catalog available; background refresh will retry`,
    );
  }

  /** Single-flight refresh. Timer, manual and startup-refresh callers share one request. */
  refresh(reason: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight !== undefined) {
      this.deps.logger.debug(`refresh (${reason}) coalesced with an in-flight refresh`);
      return this.inFlight;
    }
    const run = (async () => {
      try {
        await this.doRefresh(reason);
      } finally {
        this.inFlight = undefined;
      }
    })();
    this.inFlight = run;
    return run;
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();
  }

  private async doRefresh(reason: string): Promise<void> {
    const { config, logger } = this.deps;
    try {
      const candidate = await this.loadCandidate();
      const next: CatalogState = {
        gatewayModels: candidate.gatewayModels,
        models: candidate.models,
        skipped: candidate.skipped,
        source: "live",
        fetchedAt: this.deps.now().toISOString(),
      };
      if (canonicalState(this.state) === canonicalState(next)) {
        logger.debug(`provider=${config.providerId} catalog unchanged (${reason})`);
        return;
      }
      const previousCount = this.state.models.length;
      const nextCount = next.models.length;
      this.commit(candidate, "live", next.fetchedAt as string);
      await this.persist(candidate.gatewayModels);
      await this.deps.onCatalogChanged();
      logger.info(
        `provider=${config.providerId} catalog changed old=${previousCount} new=${nextCount}`,
      );
      this.logSkips(candidate.skipped);
    } catch (error) {
      logger.warn(
        `provider=${config.providerId} discovery failed: ${describeError(error)}; keeping last-known-good catalog`,
      );
    }
  }

  private commit(candidate: Candidate, source: CatalogSource, fetchedAt: string): void {
    this.state = {
      gatewayModels: candidate.gatewayModels,
      models: candidate.models,
      skipped: candidate.skipped,
      source,
      fetchedAt,
    };
  }

  private async loadCandidate(): Promise<Candidate> {
    const { adapter, config, logger, fetchImpl } = this.deps;
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      const context: AdapterContext = {
        baseURL: config.gatewayRoot,
        apiBaseURL: config.apiBaseURL,
        discoveryURL: config.discoveryURL,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        headers: this.buildHeaders(),
        fetchImpl,
        signal: controller.signal,
      };
      const result = await adapter.discover(context);
      for (const issue of result.issues) {
        logger.debug(
          `provider=${config.providerId} model=${issue.id} invalid ${issue.field}: ${issue.detail}`,
        );
      }
      const mapped = mapGatewayCatalog(result.models, {
        providerId: config.providerId,
        strictMetadata: config.strictMetadata,
      });
      return {
        gatewayModels: result.models,
        models: mapped.models,
        skipped: mapped.skipped,
        issues: result.issues,
      };
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  /** Authorization headers are built at request time and never stored or logged. */
  private buildHeaders(): Readonly<Record<string, string>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = this.resolveApiKey();
    if (key !== undefined) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  }

  private resolveApiKey(): string | undefined {
    const { apiKey, apiKeyEnv } = this.deps.config;
    if (apiKey !== undefined && apiKey.trim() !== "") return apiKey;
    if (apiKeyEnv === null) return undefined;
    const fromEnv = process.env[apiKeyEnv];
    if (fromEnv === undefined) return undefined;
    const trimmed = fromEnv.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async persist(models: readonly GatewayModel[]): Promise<void> {
    const cache = this.deps.cache;
    if (cache === undefined) return;
    try {
      await cache.write(this.identity, models, this.deps.now().toISOString());
    } catch (error) {
      this.deps.logger.warn(
        `provider=${this.deps.config.providerId} could not update cache: ${describeError(error)}`,
      );
    }
  }

  private async restoreFromCache(): Promise<boolean> {
    const cache = this.deps.cache;
    const { config, logger } = this.deps;
    if (cache === undefined) return false;
    try {
      const entry = await cache.read(this.identity);
      if (entry === undefined) return false;
      const mapped = mapGatewayCatalog(entry.models, {
        providerId: config.providerId,
        strictMetadata: config.strictMetadata,
      });
      this.state = {
        gatewayModels: entry.models,
        models: mapped.models,
        skipped: mapped.skipped,
        source: "cache",
        fetchedAt: entry.fetchedAt,
      };
      logger.warn(
        `provider=${config.providerId} restored ${mapped.models.length} model(s) from cache (fetchedAt=${entry.fetchedAt})`,
      );
      this.logSkips(mapped.skipped);
      return true;
    } catch (error) {
      logger.warn(
        `provider=${config.providerId} could not read cached catalog: ${describeError(error)}`,
      );
      return false;
    }
  }

  private logSummary(verb: string): void {
    const { config } = this.deps;
    this.deps.logger.info(
      `provider=${config.providerId} ${verb} discovered=${this.state.gatewayModels.length} registered=${this.state.models.length} skipped=${this.state.skipped.length}`,
    );
  }

  private logSkips(skipped: readonly SkippedModel[]): void {
    if (skipped.length === 0) return;
    const { config, logger } = this.deps;
    const warningCount = skipped.filter((entry) => entry.severity === "warning").length;
    if (warningCount > 0) {
      logger.warn(
        `provider=${config.providerId} skipped ${skipped.length} model(s) with incomplete or unsupported metadata (${warningCount} strict); set OPENCODE_GATEWAY_CATALOG_LOG_LEVEL=debug for details`,
      );
    }
    for (const entry of skipped) {
      logger.debug(`skip ${entry.id}: ${entry.reason}`);
    }
  }
}
