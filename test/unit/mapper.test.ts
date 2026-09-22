import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOmniRouteAdapter } from "../../src/adapters/omniroute.js";
import type { GatewayModel } from "../../src/adapters/types.js";
import { isSupportedSurface, mapGatewayCatalog, mapGatewayModel } from "../../src/mapper.js";

const adapter = createOmniRouteAdapter();
const options = { providerId: "testgw", strictMetadata: true };

function model(overrides: Partial<GatewayModel> & { id: string }): GatewayModel {
  return { ...overrides };
}

function mapped(overrides: Partial<GatewayModel> & { id: string }) {
  const result = mapGatewayModel(model(overrides), options);
  assert.equal(result.ok, true, `expected model ${overrides.id} to be mapped`);
  if (!result.ok) throw new Error("unreachable");
  return result.info;
}

test("limits map exactly from gateway fields", () => {
  const info = mapped({
    id: "kr/claude-sonnet-5",
    contextLength: 1_000_000,
    maxInputTokens: 999_999,
    maxOutputTokens: 128_000,
    toolCalling: true,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  });
  assert.equal(info.limit.context, 1_000_000);
  assert.equal(info.limit.input, 999_999);
  assert.equal(info.limit.output, 128_000);
});

test("missing max_input_tokens keeps limit.input unset (no inference)", () => {
  const info = mapped({
    id: "vendor/a",
    contextLength: 100_000,
    maxOutputTokens: 10_000,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.equal("input" in info.limit, false);
});

test("capabilities map exactly", () => {
  const info = mapped({
    id: "vendor/b",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: false,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  });
  assert.equal(info.capabilities.tools, false);
  assert.deepEqual(info.capabilities.input, ["text", "image"]);
  assert.deepEqual(info.capabilities.output, ["text"]);
});

test("id is preserved verbatim (slashes included) for both id and modelID", () => {
  const info = mapped({
    id: "kr/claude-sonnet-5",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.equal(info.id, "kr/claude-sonnet-5");
  assert.equal(info.modelID, "kr/claude-sonnet-5");
  assert.equal(info.providerID, "testgw");
});

test("name falls back to id only when the gateway did not provide one", () => {
  const withName = mapped({
    id: "vendor/named",
    name: "Fancy Name",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.equal(withName.name, "Fancy Name");
  const withoutName = mapped({
    id: "vendor/unnamed",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.equal(withoutName.name, "vendor/unnamed");
});

test("family is only set when the gateway provides it", () => {
  const noFamily = mapped({
    id: "vendor/x",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.equal(noFamily.family, undefined);
  const withFamily = mapped({
    id: "vendor/y",
    family: "gpt-sol",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.equal(withFamily.family, "gpt-sol");
});

test("models with incomplete required metadata are skipped in strict mode", () => {
  const cases: Array<Partial<GatewayModel>> = [
    { contextLength: undefined },
    { maxOutputTokens: undefined },
    { toolCalling: undefined },
    { inputModalities: undefined },
    { outputModalities: undefined },
    { inputModalities: [] },
    { outputModalities: [] },
  ];
  for (const missing of cases) {
    const result = mapGatewayModel(
      model({
        id: "vendor/partial",
        contextLength: 100,
        maxOutputTokens: 10,
        toolCalling: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
        ...missing,
      }),
      options,
    );
    assert.equal(result.ok, false, `expected skip for ${JSON.stringify(missing)}`);
  }
});

test("strictMetadata only changes reporting severity, never fabricates values", () => {
  const incomplete = model({
    id: "vendor/partial",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
  });
  const strict = mapGatewayModel(incomplete, { ...options, strictMetadata: true });
  const lenient = mapGatewayModel(incomplete, { ...options, strictMetadata: false });
  assert.equal(strict.ok, false);
  assert.equal(lenient.ok, false);
  if (!strict.ok && !lenient.ok) {
    assert.equal(strict.skipped.severity, "warning");
    assert.equal(lenient.skipped.severity, "info");
  }
});

test("no-enrichment: ids/names containing vendor/capability keywords add nothing", () => {
  const keywords = ["vision", "gpt", "claude", "qwen", "kimi", "reasoning", "coder", "thinking"];
  for (const keyword of keywords) {
    const info = mapped({
      id: `vendor/model-with-${keyword}-name`,
      name: `Anthropic Claude GPT ${keyword} Coder`,
      contextLength: 100_000,
      maxOutputTokens: 10_000,
      toolCalling: false,
      inputModalities: ["text"],
      outputModalities: ["text"],
    });
    assert.deepEqual(info.capabilities.input, ["text"]);
    assert.equal(info.capabilities.tools, false);
  }
});

test("vision=true without input_modalities never creates image capability", () => {
  const { models } = adapter.parse(
    JSON.parse(
      readFileSync(new URL("../fixtures/omniroute-vision-flag-only.json", import.meta.url), "utf8"),
    ) as unknown,
  );
  const result = mapGatewayModel(models[0]!, options);
  assert.equal(result.ok, false);
});

test("combo model without modalities is skipped", () => {
  const parsed = JSON.parse(
    readFileSync(new URL("../fixtures/omniroute-combo.json", import.meta.url), "utf8"),
  ) as unknown;
  const { models } = adapter.parse(parsed);
  const result = mapGatewayModel(models[0]!, options);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.skipped.reason, /input_modalities/);
    assert.match(result.skipped.reason, /output_modalities/);
  }
});

test("image-only output surfaces are filtered out using explicit fields", () => {
  const verdict = isSupportedSurface(
    model({ id: "vendor/image-model", outputModalities: ["image"] }),
  );
  assert.equal(verdict.supported, false);
  const ok = isSupportedSurface(model({ id: "vendor/chat-model", outputModalities: ["text"] }));
  assert.equal(ok.supported, true);
});

test("supported_endpoints without chat/completions are filtered out", () => {
  assert.equal(
    isSupportedSurface(model({ id: "v/x", supportedEndpoints: ["embeddings"] })).supported,
    false,
  );
  assert.equal(
    isSupportedSurface(model({ id: "v/y", supportedEndpoints: ["chat"] })).supported,
    true,
  );
});

test("explicit non-chat type/surface fields are filtered out", () => {
  assert.equal(isSupportedSurface(model({ id: "v/x", type: "embedding" })).supported, false);
  assert.equal(isSupportedSurface(model({ id: "v/y", surface: "rerank" })).supported, false);
  assert.equal(isSupportedSurface(model({ id: "v/z", type: "chat" })).supported, true);
});

test("cost mapping: complete pricing only", () => {
  const complete = mapped({
    id: "vendor/complete",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
    pricing: { input: 3, output: 15, cached: 1.5, cacheCreation: 3, reasoning: 15 },
  });
  assert.equal(complete.cost.length, 1);
  assert.equal(complete.cost[0]?.input, 3);
  assert.equal(complete.cost[0]?.output, 15);
  assert.equal(complete.cost[0]?.cache.read, 1.5);
  assert.equal(complete.cost[0]?.cache.write, 3);
});

test("cost mapping: partial pricing does not get zero-filled", () => {
  for (const pricing of [
    {},
    { input: 1 },
    { input: 1, output: 2 },
    { input: 1, output: 2, cached: 0.5 },
    { input: 1, output: 2, cacheCreation: 0.5 },
  ]) {
    const info = mapped({
      id: "vendor/partial-pricing",
      contextLength: 100,
      maxOutputTokens: 10,
      toolCalling: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
      pricing,
    });
    assert.deepEqual(info.cost, []);
  }
});

test("cost mapping: free model with explicit zeros keeps one tier", () => {
  const info = mapped({
    id: "vendor/free",
    contextLength: 100,
    maxOutputTokens: 10,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
    pricing: { input: 0, output: 0, cached: 0, cacheCreation: 0 },
  });
  assert.equal(info.cost.length, 1);
  assert.equal(info.cost[0]?.input, 0);
  assert.equal(info.cost[0]?.cache.write, 0);
});

test("catalog mapping is deterministically sorted by id", () => {
  const result = mapGatewayCatalog(
    [
      model({
        id: "vendor/z",
        contextLength: 1,
        maxOutputTokens: 1,
        toolCalling: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
      }),
      model({
        id: "vendor/a",
        contextLength: 1,
        maxOutputTokens: 1,
        toolCalling: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
      }),
    ],
    options,
  );
  assert.deepEqual(
    result.models.map((info) => info.id),
    ["vendor/a", "vendor/z"],
  );
});

test("variants are always empty and released timestamp is the structural default", () => {
  const info = mapped({
    id: "vendor/plain",
    contextLength: 1,
    maxOutputTokens: 1,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  });
  assert.deepEqual(info.variants, []);
  assert.equal(info.time.released, 0);
  assert.equal(info.status, "active");
  assert.equal(info.enabled, true);
});
