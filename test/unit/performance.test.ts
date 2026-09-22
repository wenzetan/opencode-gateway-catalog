import assert from "node:assert/strict";
import { test } from "node:test";
import type { GatewayModel } from "../../src/adapters/types.js";
import { mapGatewayCatalog } from "../../src/mapper.js";

function model(index: number): GatewayModel {
  return {
    id: `vendor/team-${index % 10}/model-${index}`,
    name: `Model ${index}`,
    family: `family-${index % 5}`,
    contextLength: 100_000 + index,
    maxInputTokens: 90_000 + index,
    maxOutputTokens: 8_000,
    toolCalling: true,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    pricing: { input: 1, output: 2, cached: 0.5, cacheCreation: 0.25 },
  };
}

test("mapping 1000 models stays well below a second", () => {
  const models = Array.from({ length: 1000 }, (_, index) => model(index));
  const started = performance.now();
  const mapped = mapGatewayCatalog(models, { providerId: "big", strictMetadata: true });
  const elapsed = performance.now() - started;
  assert.equal(mapped.models.length, 1000);
  assert.equal(mapped.skipped.length, 0);
  assert.ok(elapsed < 1000, `mapping took ${elapsed.toFixed(1)}ms`);
});

test("catalog output is deterministically sorted for 1000 models", () => {
  const models = Array.from({ length: 1000 }, (_, index) => model(999 - index));
  const mapped = mapGatewayCatalog(models, { providerId: "big", strictMetadata: true });
  const ids = mapped.models.map((info) => String(info.id));
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted);
});
