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

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GatewayModel } from "./adapters/types.js";
import { CacheError } from "./errors.js";
import type { Logger } from "./logger.js";
import {
  isRecord,
  readBoolean,
  readNonEmptyString,
  readNonNegativeNumber,
  readPositiveInt,
  readStringArray,
} from "./validation.js";

export const CACHE_VERSION = 2;

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

export function defaultCacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  const base = xdg !== undefined && xdg.trim() !== "" ? xdg : join(homedir(), ".cache");
  return join(base, "opencode-gateway-catalog");
}

export function cacheFileName(identity: CacheIdentity): string {
  const hash = createHash("sha256")
    .update(`${identity.adapter}\n${identity.providerId}\n${identity.baseURL}`)
    .digest("hex")
    .slice(0, 12);
  const safeProviderId = identity.providerId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safeProviderId}-${hash}.json`;
}

function parseCachedModel(value: unknown): GatewayModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = readNonEmptyString(value["id"]);
  if (id === undefined) return undefined;

  const name = readNonEmptyString(value["name"]);
  const family = readNonEmptyString(value["family"]);
  const contextLength = readPositiveInt(value["context_length"]);
  const maxInputTokens = readPositiveInt(value["max_input_tokens"]);
  const maxOutputTokens = readPositiveInt(value["max_output_tokens"]);
  const toolCalling = readBoolean(value["tool_calling"]);
  const inputModalities = readStringArray(value["input_modalities"]);
  const outputModalities = readStringArray(value["output_modalities"]);
  const vision = readBoolean(value["vision"]);
  const reasoning = readBoolean(value["reasoning"]);
  const thinking = readBoolean(value["thinking"]);
  const effortTiers = readStringArray(value["effort_tiers"]);
  const supportedEndpoints = readStringArray(value["supported_endpoints"]);
  const surface = readNonEmptyString(value["surface"]);
  const type = readNonEmptyString(value["type"]);

  let pricing: GatewayModel["pricing"];
  if (isRecord(value["pricing"])) {
    const raw = value["pricing"];
    const input = readNonNegativeNumber(raw["input"]);
    const output = readNonNegativeNumber(raw["output"]);
    const cached = readNonNegativeNumber(raw["cached"]);
    const cacheCreation = readNonNegativeNumber(raw["cache_creation"]);
    const pricingReasoning = readNonNegativeNumber(raw["reasoning"]);
    pricing = {
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(cached !== undefined ? { cached } : {}),
      ...(cacheCreation !== undefined ? { cacheCreation } : {}),
      ...(pricingReasoning !== undefined ? { reasoning: pricingReasoning } : {}),
    };
  }

  return {
    id,
    ...(name !== undefined ? { name } : {}),
    ...(family !== undefined ? { family } : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(toolCalling !== undefined ? { toolCalling } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
    ...(outputModalities !== undefined ? { outputModalities } : {}),
    ...(vision !== undefined ? { vision } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(effortTiers !== undefined ? { effortTiers } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    ...(supportedEndpoints !== undefined ? { supportedEndpoints } : {}),
    ...(surface !== undefined ? { surface } : {}),
    ...(type !== undefined ? { type } : {}),
  };
}

/**
 * Serializes canonical models for the cache. Kept separate so tests can assert
 * that no secret-like fields are persisted.
 */
export function serializeCachedModels(models: readonly GatewayModel[]): unknown[] {
  return models.map((model) => ({
    id: model.id,
    ...(model.name !== undefined ? { name: model.name } : {}),
    ...(model.family !== undefined ? { family: model.family } : {}),
    ...(model.contextLength !== undefined ? { context_length: model.contextLength } : {}),
    ...(model.maxInputTokens !== undefined ? { max_input_tokens: model.maxInputTokens } : {}),
    ...(model.maxOutputTokens !== undefined ? { max_output_tokens: model.maxOutputTokens } : {}),
    ...(model.toolCalling !== undefined ? { tool_calling: model.toolCalling } : {}),
    ...(model.inputModalities !== undefined
      ? { input_modalities: [...model.inputModalities] }
      : {}),
    ...(model.outputModalities !== undefined
      ? { output_modalities: [...model.outputModalities] }
      : {}),
    ...(model.vision !== undefined ? { vision: model.vision } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.thinking !== undefined ? { thinking: model.thinking } : {}),
    ...(model.effortTiers !== undefined ? { effort_tiers: [...model.effortTiers] } : {}),
    ...(model.pricing !== undefined
      ? {
          pricing: {
            ...(model.pricing.input !== undefined ? { input: model.pricing.input } : {}),
            ...(model.pricing.output !== undefined ? { output: model.pricing.output } : {}),
            ...(model.pricing.cached !== undefined ? { cached: model.pricing.cached } : {}),
            ...(model.pricing.cacheCreation !== undefined
              ? { cache_creation: model.pricing.cacheCreation }
              : {}),
            ...(model.pricing.reasoning !== undefined
              ? { reasoning: model.pricing.reasoning }
              : {}),
          },
        }
      : {}),
    ...(model.supportedEndpoints !== undefined
      ? { supported_endpoints: [...model.supportedEndpoints] }
      : {}),
    ...(model.surface !== undefined ? { surface: model.surface } : {}),
    ...(model.type !== undefined ? { type: model.type } : {}),
  }));
}

export interface CacheStoreOptions {
  readonly dir?: string;
  readonly logger: Logger;
}

export class DiskCache {
  private readonly dir: string;
  private readonly logger: Logger;

  constructor(options: CacheStoreOptions) {
    this.dir = options.dir ?? defaultCacheDir();
    this.logger = options.logger;
  }

  get directory(): string {
    return this.dir;
  }

  private pathFor(identity: CacheIdentity): string {
    return join(this.dir, cacheFileName(identity));
  }

  async read(identity: CacheIdentity): Promise<CacheEntry | undefined> {
    const path = this.pathFor(identity);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new CacheError("failed to read cached catalog", { cause: error, detail: path });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.logger.warn(`cache file is corrupt and will be ignored: ${path}`);
      return undefined;
    }
    if (!isRecord(parsed)) {
      this.logger.warn(`cache file has an unexpected shape and will be ignored: ${path}`);
      return undefined;
    }
    if (
      parsed["version"] !== CACHE_VERSION ||
      parsed["adapter"] !== identity.adapter ||
      parsed["providerId"] !== identity.providerId ||
      parsed["baseURL"] !== identity.baseURL
    ) {
      this.logger.warn(`cache file identity mismatch and will be ignored: ${path}`);
      return undefined;
    }
    const fetchedAt = readNonEmptyString(parsed["fetchedAt"]);
    const rawModels = parsed["models"];
    if (fetchedAt === undefined || !Array.isArray(rawModels)) {
      this.logger.warn(`cache file is missing required fields and will be ignored: ${path}`);
      return undefined;
    }
    const models: GatewayModel[] = [];
    for (const item of rawModels) {
      const model = parseCachedModel(item);
      if (model === undefined) {
        this.logger.warn(`cache file contains an invalid model entry and will be ignored: ${path}`);
        return undefined;
      }
      models.push(model);
    }
    return {
      version: CACHE_VERSION,
      adapter: identity.adapter,
      providerId: identity.providerId,
      baseURL: identity.baseURL,
      fetchedAt,
      models,
    };
  }

  async write(
    identity: CacheIdentity,
    models: readonly GatewayModel[],
    fetchedAt: string,
  ): Promise<void> {
    const path = this.pathFor(identity);
    const payload: CacheEntry = {
      version: CACHE_VERSION,
      adapter: identity.adapter,
      providerId: identity.providerId,
      baseURL: identity.baseURL,
      fetchedAt,
      models: serializeCachedModels(models) as unknown as readonly GatewayModel[],
    };
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
      await rename(tempPath, path);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw new CacheError("failed to write cached catalog", { cause: error, detail: path });
    }
  }
}
