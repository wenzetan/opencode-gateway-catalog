/**
 * OmniRoute adapter.
 *
 * OmniRoute is the source of truth for model metadata: this file only performs
 * transport-facing parsing and strict field validation. It never enriches,
 * infers or "fixes" metadata. Missing or malformed fields stay missing.
 */

import {
  readCatalogData,
  readModelItems,
  isRecord,
  readBoolean,
  readNonEmptyString,
  readNonNegativeNumber,
  readPositiveInt,
  readStringArray,
} from "../validation.js";
import { fetchJson } from "../discovery.js";
import type {
  AdapterContext,
  GatewayAdapter,
  GatewayModel,
  GatewayPricing,
  ModelIssue,
  ParseResult,
} from "./types.js";

interface ParseFieldsState {
  readonly id: string;
  readonly issues: ModelIssue[];
}

function invalid(state: ParseFieldsState, field: string, detail: string): void {
  state.issues.push({ id: state.id, kind: "invalid", field, detail });
}

function readField<T>(
  state: ParseFieldsState,
  rawValue: unknown,
  field: string,
  parser: (value: unknown) => T | undefined,
): T | undefined {
  if (rawValue === undefined) return undefined;
  const parsed = parser(rawValue);
  if (parsed === undefined) {
    invalid(state, field, "present but not a valid value");
    return undefined;
  }
  return parsed;
}

function parseCapabilities(
  state: ParseFieldsState,
  raw: unknown,
): { toolCalling?: boolean; vision?: boolean; reasoning?: boolean; thinking?: boolean } {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    invalid(state, "capabilities", "must be an object");
    return {};
  }
  return {
    toolCalling: readField(state, raw["tool_calling"], "capabilities.tool_calling", readBoolean),
    vision: readField(state, raw["vision"], "capabilities.vision", readBoolean),
    reasoning: readField(state, raw["reasoning"], "capabilities.reasoning", readBoolean),
    thinking:
      readField(state, raw["thinking"], "capabilities.thinking", readBoolean) ??
      readField(state, raw["supportsThinking"], "capabilities.supportsThinking", readBoolean),
  };
}

function parsePricing(state: ParseFieldsState, raw: unknown): GatewayPricing | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    invalid(state, "pricing", "must be an object");
    return undefined;
  }
  const pricing: GatewayPricing = {
    input: readField(state, raw["input"], "pricing.input", readNonNegativeNumber),
    output: readField(state, raw["output"], "pricing.output", readNonNegativeNumber),
    cached: readField(state, raw["cached"], "pricing.cached", readNonNegativeNumber),
    cacheCreation: readField(
      state,
      raw["cache_creation"],
      "pricing.cache_creation",
      readNonNegativeNumber,
    ),
    reasoning: readField(state, raw["reasoning"], "pricing.reasoning", readNonNegativeNumber),
  };
  return pricing;
}

function parseModel(item: Record<string, unknown>, id: string, issues: ModelIssue[]): GatewayModel {
  const state: ParseFieldsState = { id, issues };
  const capabilities = parseCapabilities(state, item["capabilities"]);

  return {
    id,
    name: readField(state, item["name"], "name", readNonEmptyString),
    family: readField(state, item["family"], "family", readNonEmptyString),
    contextLength: readField(state, item["context_length"], "context_length", readPositiveInt),
    maxInputTokens: readField(state, item["max_input_tokens"], "max_input_tokens", readPositiveInt),
    maxOutputTokens: readField(
      state,
      item["max_output_tokens"],
      "max_output_tokens",
      readPositiveInt,
    ),
    toolCalling: capabilities.toolCalling,
    inputModalities: readField(
      state,
      item["input_modalities"],
      "input_modalities",
      readStringArray,
    ),
    outputModalities: readField(
      state,
      item["output_modalities"],
      "output_modalities",
      readStringArray,
    ),
    vision: capabilities.vision,
    reasoning: capabilities.reasoning,
    thinking: capabilities.thinking,
    pricing: parsePricing(state, item["pricing"]),
    supportedEndpoints: readField(
      state,
      item["supported_endpoints"],
      "supported_endpoints",
      readStringArray,
    ),
    surface: readField(state, item["surface"], "surface", readNonEmptyString),
    type: readField(state, item["type"], "type", readNonEmptyString),
    raw: item,
  };
}

function parseResponse(payload: unknown): ParseResult {
  const data = readCatalogData(payload);
  const items = readModelItems(data);
  const issues: ModelIssue[] = [];
  const models = items.map((entry) => parseModel(entry.item, entry.id, issues));
  return { models, issues };
}

export function createOmniRouteAdapter(): GatewayAdapter {
  return {
    id: "omniroute",
    parse: parseResponse,
    async discover(context: AdapterContext): Promise<ParseResult> {
      const payload = await fetchJson({
        url: context.discoveryURL,
        headers: context.headers,
        timeoutMs: context.timeoutMs,
        maxBytes: context.maxResponseBytes,
        fetchImpl: context.fetchImpl,
        signal: context.signal,
      });
      return parseResponse(payload);
    },
  };
}
