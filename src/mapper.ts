/**
 * Canonical `GatewayModel` -> OpenCode `Model.Info` mapping.
 *
 * This module performs NO enrichment:
 *  - no models.dev lookup
 *  - no model-name heuristics
 *  - no capability/limit/pricing guesses
 *
 * Required OpenCode fields that the gateway does not provide cause the model to
 * be skipped (the default). The optimistic defaults that OpenCode applies to
 * unknown custom models (200k context / 32k output / tools+image) are
 * deliberately never used as metadata.
 *
 * `strictMetadata` controls the reporting severity of those skips only:
 *  - true (default): missing/invalid required metadata is a warning
 *  - false: the same models are still skipped, but reported at info level
 * It never means "make something up". `[]`, `false` and synthetic limits are
 * not valid fallbacks for unknown metadata.
 */

import type { Model } from "@opencode/plugin";
import type { GatewayModel } from "./adapters/types.js";

export interface SkippedModel {
  readonly id: string;
  readonly reason: string;
  readonly missing: readonly string[];
  readonly severity: "warning" | "info";
}

export interface MappedCatalog {
  readonly models: Model.Info[];
  readonly skipped: SkippedModel[];
}

export interface MapOptions {
  readonly providerId: string;
  readonly strictMetadata: boolean;
}

interface Problem {
  readonly missing: string[];
  readonly invalid: string[];
}

interface SurfaceVerdict {
  readonly supported: boolean;
  readonly reason?: string;
}

const NON_CHAT_SURFACES = new Set<string>([
  "embedding",
  "embeddings",
  "rerank",
  "reranker",
  "moderation",
  "audio",
  "speech",
  "tts",
  "transcription",
  "image",
  "images",
  "video",
  "music",
  "ocr",
  "classification",
]);

const CHAT_ENDPOINT_HINTS = new Set<string>([
  "chat",
  "completions",
  "chat/completions",
  "chat.completions",
  "responses",
  "messages",
]);

function normalizeSurface(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Surface filter based exclusively on explicit gateway fields:
 * `type`, `surface`, `supported_endpoints` and `output_modalities`.
 * Model ids and names are never inspected.
 */
export function isSupportedSurface(model: GatewayModel): SurfaceVerdict {
  for (const field of ["type", "surface"] as const) {
    const value = model[field];
    if (value === undefined) continue;
    const normalized = normalizeSurface(value);
    if (NON_CHAT_SURFACES.has(normalized)) {
      return { supported: false, reason: `gateway ${field} "${value}" is not a chat surface` };
    }
  }
  if (model.supportedEndpoints !== undefined && model.supportedEndpoints.length > 0) {
    const hasChatEndpoint = model.supportedEndpoints.some((endpoint) =>
      CHAT_ENDPOINT_HINTS.has(normalizeSurface(endpoint)),
    );
    if (!hasChatEndpoint) {
      return {
        supported: false,
        reason: "gateway supported_endpoints does not include a chat/completions endpoint",
      };
    }
  }
  if (
    model.outputModalities !== undefined &&
    model.outputModalities.length > 0 &&
    !model.outputModalities.includes("text")
  ) {
    return { supported: false, reason: 'gateway output_modalities does not include "text"' };
  }
  return { supported: true };
}

function collectRequiredProblems(model: GatewayModel): Problem {
  const missing: string[] = [];
  const invalid: string[] = [];

  const requirePositiveInt = (field: string, value: number | undefined): void => {
    if (value === undefined) missing.push(field);
    else if (!Number.isSafeInteger(value) || value <= 0) invalid.push(field);
  };

  requirePositiveInt("context_length", model.contextLength);
  requirePositiveInt("max_output_tokens", model.maxOutputTokens);

  if (model.toolCalling === undefined) missing.push("capabilities.tool_calling");
  else if (typeof model.toolCalling !== "boolean") invalid.push("capabilities.tool_calling");

  if (model.inputModalities === undefined || model.inputModalities.length === 0) {
    missing.push("input_modalities");
  }
  if (model.outputModalities === undefined || model.outputModalities.length === 0) {
    missing.push("output_modalities");
  }

  return { missing, invalid };
}

/**
 * Money values are validated as finite non-negative numbers by the parser.
 * The OpenCode schema brands them; the assertion below is safe because of that
 * prior validation.
 */
type MoneyValue = Model.Cost["input"];

function money(value: number): MoneyValue {
  return value as MoneyValue;
}

function buildCost(model: GatewayModel): Model.Cost[] {
  const pricing = model.pricing;
  if (pricing === undefined) return [];
  const { input, output, cached, cacheCreation } = pricing;
  if (
    input === undefined ||
    output === undefined ||
    cached === undefined ||
    cacheCreation === undefined
  ) {
    // Do not synthesize missing tiers and do not fill zeros: `[]` means "the
    // gateway did not provide enough pricing information".
    return [];
  }
  return [
    {
      input: money(input),
      output: money(output),
      cache: { read: money(cached), write: money(cacheCreation) },
    },
  ];
}

export function mapGatewayModel(
  model: GatewayModel,
  options: MapOptions,
):
  | { readonly ok: true; readonly info: Model.Info }
  | { readonly ok: false; readonly skipped: SkippedModel } {
  const surface = isSupportedSurface(model);
  if (!surface.supported) {
    return {
      ok: false,
      skipped: {
        id: model.id,
        reason: surface.reason ?? "unsupported surface",
        missing: [],
        severity: options.strictMetadata ? "warning" : "info",
      },
    };
  }

  const problems = collectRequiredProblems(model);
  if (problems.missing.length > 0 || problems.invalid.length > 0) {
    const details: string[] = [];
    if (problems.missing.length > 0) details.push(`missing ${problems.missing.join(", ")}`);
    if (problems.invalid.length > 0) details.push(`invalid ${problems.invalid.join(", ")}`);
    return {
      ok: false,
      skipped: {
        id: model.id,
        reason: details.join("; "),
        missing: [...problems.missing, ...problems.invalid],
        severity: options.strictMetadata ? "warning" : "info",
      },
    };
  }

  const id = model.id as Model.Info["id"];
  const providerID = options.providerId as Model.Info["providerID"];

  const info: Model.Info = {
    id,
    modelID: id,
    providerID,
    name: model.name ?? model.id,
    ...(model.family !== undefined ? { family: model.family as Model.Info["family"] } : {}),
    capabilities: {
      tools: model.toolCalling as boolean,
      input: [...(model.inputModalities as readonly string[])],
      output: [...(model.outputModalities as readonly string[])],
    },
    // Structural defaults only: no variants are defined by this plugin and
    // `cost: []` means "not enough information", not "free".
    variants: [],
    time: { released: 0 },
    cost: buildCost(model),
    status: "active",
    enabled: true,
    limit: {
      context: model.contextLength as number,
      ...(model.maxInputTokens !== undefined ? { input: model.maxInputTokens } : {}),
      output: model.maxOutputTokens as number,
    },
  };

  return { ok: true, info };
}

export function mapGatewayCatalog(
  models: readonly GatewayModel[],
  options: MapOptions,
): MappedCatalog {
  const mapped: Model.Info[] = [];
  const skipped: SkippedModel[] = [];
  for (const model of models) {
    const result = mapGatewayModel(model, options);
    if (result.ok) mapped.push(result.info);
    else skipped.push(result.skipped);
  }
  mapped.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  skipped.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { models: mapped, skipped };
}
