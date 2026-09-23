import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOmniRouteAdapter } from "../../src/adapters/omniroute.js";
import { CatalogIntegrityError } from "../../src/errors.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as unknown;

const adapter = createOmniRouteAdapter();

test("full model metadata is parsed verbatim", () => {
  const { models, issues } = adapter.parse(fixture("omniroute-full.json"));
  assert.equal(issues.length, 0);
  assert.equal(models.length, 1);
  const model = models[0]!;
  assert.equal(model.id, "kr/claude-sonnet-5");
  assert.equal(model.name, "kr/Claude Sonnet 5");
  assert.equal(model.family, "claude-sonnet");
  assert.equal(model.contextLength, 1_000_000);
  assert.equal(model.maxInputTokens, 1_000_000);
  assert.equal(model.maxOutputTokens, 128_000);
  assert.equal(model.toolCalling, true);
  assert.deepEqual(model.inputModalities, ["text", "image"]);
  assert.deepEqual(model.outputModalities, ["text"]);
  assert.equal(model.vision, true);
  assert.equal(model.reasoning, true);
  assert.equal(model.thinking, true);
  assert.deepEqual(model.effortTiers, ["none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(model.pricing, {
    input: 3,
    output: 15,
    cached: 1.5,
    cacheCreation: 3,
    reasoning: 15,
  });
});

test("incomplete models keep missing fields undefined", () => {
  const { models } = adapter.parse(fixture("omniroute-incomplete.json"));
  const byId = new Map(models.map((model) => [model.id, model]));
  assert.equal(byId.get("vendor/missing-output")?.maxOutputTokens, undefined);
  assert.equal(byId.get("vendor/missing-modalities")?.inputModalities, undefined);
  assert.equal(byId.get("vendor/missing-modalities")?.outputModalities, undefined);
  assert.equal(byId.get("vendor/missing-tools")?.toolCalling, undefined);
});

test("combo model without modalities and vision flags stays undefined", () => {
  const { models } = adapter.parse(fixture("omniroute-combo.json"));
  const model = models[0]!;
  assert.equal(model.inputModalities, undefined);
  assert.equal(model.outputModalities, undefined);
  assert.equal(model.vision, undefined);
  assert.equal(model.reasoning, true);
  assert.equal(model.toolCalling, true);
});

test("vision flag without input_modalities does not create modalities", () => {
  const { models } = adapter.parse(fixture("omniroute-vision-flag-only.json"));
  const model = models[0]!;
  assert.equal(model.vision, true);
  assert.equal(model.inputModalities, undefined);
});

test("duplicate ids reject the whole catalog", () => {
  assert.throws(() => adapter.parse(fixture("duplicate-models.json")), CatalogIntegrityError);
});

test("missing or empty ids reject the whole catalog", () => {
  assert.throws(() => adapter.parse({ data: [{ name: "x" }] }), CatalogIntegrityError);
  assert.throws(() => adapter.parse({ data: [{ id: "" }] }), CatalogIntegrityError);
  assert.throws(() => adapter.parse({ data: [42] }), CatalogIntegrityError);
  assert.throws(() => adapter.parse({ data: "not-an-array" }), CatalogIntegrityError);
  assert.throws(() => adapter.parse(null), CatalogIntegrityError);
});

test("wrong field types are reported as issues and stay undefined", () => {
  const { models, issues } = adapter.parse({
    data: [
      {
        id: "vendor/bad-types",
        context_length: "1000000",
        max_output_tokens: -1,
        max_input_tokens: Number.NaN,
        tool_calling: true,
        capabilities: { tool_calling: "yes" },
        input_modalities: ["text", ""],
        output_modalities: ["text"],
        pricing: { input: "3" },
      },
    ],
  });
  const model = models[0]!;
  assert.equal(model.contextLength, undefined);
  assert.equal(model.maxOutputTokens, undefined);
  assert.equal(model.maxInputTokens, undefined);
  assert.equal(model.toolCalling, undefined);
  assert.equal(model.inputModalities, undefined);
  // pricing object is preserved but the invalid tier stays undefined so the
  // mapper never zero-fills it.
  assert.equal(model.pricing?.input, undefined);
  const fields = issues.map((issue) => issue.field);
  assert.ok(fields.includes("context_length"));
  assert.ok(fields.includes("max_output_tokens"));
  assert.ok(fields.includes("capabilities.tool_calling"));
  assert.ok(fields.includes("input_modalities"));
  assert.ok(fields.includes("pricing.input"));
});

test("pricing accepts zero (free models) and rejects negatives", () => {
  const { models } = adapter.parse({
    data: [
      {
        id: "free/model",
        pricing: { input: 0, output: 0, cached: 0, cache_creation: 0 },
      },
    ],
  });
  assert.deepEqual(models[0]?.pricing, {
    input: 0,
    output: 0,
    cached: 0,
    cacheCreation: 0,
    reasoning: undefined,
  });
});
