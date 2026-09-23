/**
 * Canonical `GatewayModel` -> OpenCode `Model.Info` mapping.
 *
 * This module performs NO enrichment:
 *  - no models.dev lookup
 *  - no model-name heuristics
 *  - no capability/limit/pricing guesses
 *  - no synthesized variants (only explicit gateway `effort_tiers` are mapped)
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
const NON_CHAT_SURFACES = new Set([
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
const CHAT_ENDPOINT_HINTS = new Set([
    "chat",
    "completions",
    "chat/completions",
    "chat.completions",
    "responses",
    "messages",
]);
function normalizeSurface(value) {
    return value.trim().toLowerCase();
}
/**
 * Surface filter based exclusively on explicit gateway fields:
 * `type`, `surface`, `supported_endpoints` and `output_modalities`.
 * Model ids and names are never inspected.
 */
export function isSupportedSurface(model) {
    for (const field of ["type", "surface"]) {
        const value = model[field];
        if (value === undefined)
            continue;
        const normalized = normalizeSurface(value);
        if (NON_CHAT_SURFACES.has(normalized)) {
            return { supported: false, reason: `gateway ${field} "${value}" is not a chat surface` };
        }
    }
    if (model.supportedEndpoints !== undefined && model.supportedEndpoints.length > 0) {
        const hasChatEndpoint = model.supportedEndpoints.some((endpoint) => CHAT_ENDPOINT_HINTS.has(normalizeSurface(endpoint)));
        if (!hasChatEndpoint) {
            return {
                supported: false,
                reason: "gateway supported_endpoints does not include a chat/completions endpoint",
            };
        }
    }
    if (model.outputModalities !== undefined &&
        model.outputModalities.length > 0 &&
        !model.outputModalities.includes("text")) {
        return { supported: false, reason: 'gateway output_modalities does not include "text"' };
    }
    return { supported: true };
}
function collectRequiredProblems(model) {
    const missing = [];
    const invalid = [];
    const requirePositiveInt = (field, value) => {
        if (value === undefined)
            missing.push(field);
        else if (!Number.isSafeInteger(value) || value <= 0)
            invalid.push(field);
    };
    requirePositiveInt("context_length", model.contextLength);
    requirePositiveInt("max_output_tokens", model.maxOutputTokens);
    if (model.toolCalling === undefined)
        missing.push("capabilities.tool_calling");
    else if (typeof model.toolCalling !== "boolean")
        invalid.push("capabilities.tool_calling");
    if (model.inputModalities === undefined || model.inputModalities.length === 0) {
        missing.push("input_modalities");
    }
    if (model.outputModalities === undefined || model.outputModalities.length === 0) {
        missing.push("output_modalities");
    }
    return { missing, invalid };
}
function money(value) {
    return value;
}
function buildCost(model) {
    const pricing = model.pricing;
    if (pricing === undefined)
        return [];
    const { input, output, cached, cacheCreation } = pricing;
    if (input === undefined ||
        output === undefined ||
        cached === undefined ||
        cacheCreation === undefined) {
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
/**
 * Maps gateway-provided reasoning effort levels (`capabilities.effort_tiers`)
 * to OpenCode variants, one per tier, verbatim: `id` is the tier name and
 * `settings.reasoningEffort` is set to the same value. OpenCode's
 * OpenAI-compatible provider serializes `reasoningEffort` to `reasoning_effort`
 * on the wire, so the gateway receives exactly the tier it advertised.
 *
 * No tiers are invented: a gateway that omits `effort_tiers` yields `[]`.
 * Duplicate tiers are collapsed so variant ids stay unique.
 */
function buildVariants(model) {
    const tiers = model.effortTiers;
    if (tiers === undefined || tiers.length === 0)
        return [];
    const seen = new Set();
    const variants = [];
    for (const tier of tiers) {
        if (seen.has(tier))
            continue;
        seen.add(tier);
        variants.push({
            id: tier,
            settings: { reasoningEffort: tier },
        });
    }
    return variants;
}
export function mapGatewayModel(model, options) {
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
        const details = [];
        if (problems.missing.length > 0)
            details.push(`missing ${problems.missing.join(", ")}`);
        if (problems.invalid.length > 0)
            details.push(`invalid ${problems.invalid.join(", ")}`);
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
    const id = model.id;
    const providerID = options.providerId;
    const info = {
        id,
        modelID: id,
        providerID,
        name: model.name ?? model.id,
        ...(model.family !== undefined ? { family: model.family } : {}),
        capabilities: {
            tools: model.toolCalling,
            input: [...model.inputModalities],
            output: [...model.outputModalities],
        },
        // Variants come from the gateway's explicit `effort_tiers` only; `cost: []`
        // means "not enough information", not "free".
        variants: buildVariants(model),
        time: { released: 0 },
        cost: buildCost(model),
        status: "active",
        enabled: true,
        limit: {
            context: model.contextLength,
            ...(model.maxInputTokens !== undefined ? { input: model.maxInputTokens } : {}),
            output: model.maxOutputTokens,
        },
    };
    return { ok: true, info };
}
export function mapGatewayCatalog(models, options) {
    const mapped = [];
    const skipped = [];
    for (const model of models) {
        const result = mapGatewayModel(model, options);
        if (result.ok)
            mapped.push(result.info);
        else
            skipped.push(result.skipped);
    }
    mapped.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    skipped.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { models: mapped, skipped };
}
//# sourceMappingURL=mapper.js.map