import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { registerCatalog } from "../../src/index.js";
import type { Model, Provider } from "@opencode/plugin";

type Context = Parameters<import("@opencode/plugin").Plugin.Plugin["setup"]>[0];
type TransformCallback = Parameters<Context["provider"]["transform"]>[0];
type Editor = TransformCallback extends (input: infer I) => void ? I : never;

interface AddedInput {
  info: Provider.Info;
  models: readonly Model.Info[];
}

function fakeEditor(existing?: { package?: string; baseURL?: string }): {
  editor: Editor;
  added: AddedInput[];
  updated: Array<Record<string, unknown>>;
  modelSets: Array<{ providerID: string; count: number }>;
} {
  const added: AddedInput[] = [];
  const updated: Array<Record<string, unknown>> = [];
  const modelSets: Array<{ providerID: string; count: number }> = [];
  const record = {
    provider: {
      id: "testgw",
      name: "Existing",
      activation: "enabled",
      package: existing?.package ?? "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: existing?.baseURL ?? "http://127.0.0.1:1/v1" },
    },
    models: new Map<string, Model.Info>(),
  };
  const editor = {
    get: (providerID: string) =>
      existing === undefined || providerID !== "testgw" ? undefined : record,
    add: (input: AddedInput) => {
      added.push(input);
    },
    update: (providerID: string, update: (provider: Record<string, unknown>) => void) => {
      const provider = record.provider as unknown as Record<string, unknown>;
      update(provider);
      updated.push({ ...provider });
    },
    remove: () => undefined,
    list: () => [],
    models: {
      set: (providerID: string, models: readonly Model.Info[]) => {
        modelSets.push({ providerID, count: models.length });
      },
      update: () => undefined,
      remove: () => undefined,
    },
  } as unknown as Editor;
  return { editor, added, updated, modelSets };
}

const modelInfo = (id: string): Model.Info =>
  ({
    id,
    modelID: id,
    providerID: "testgw",
    name: id,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 10 },
  }) as unknown as Model.Info;

const state = {
  gatewayModels: [],
  models: [modelInfo("vendor/a")],
  skipped: [],
  source: "live" as const,
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

test("registers provider and models through the editor when there is no conflict", () => {
  const config = parseConfig({
    baseURL: "http://127.0.0.1:1",
    providerId: "testgw",
    providerName: "Test Gateway",
  }).config;
  const { editor, added } = fakeEditor(undefined);
  const logger = createLogger({ level: "debug", sink: () => undefined });
  registerCatalog(editor, state, config, logger);
  assert.equal(added.length, 1);
  assert.equal(added[0]!.info.id, "testgw");
  assert.equal(added[0]!.info.activation, "enabled");
  assert.equal(added[0]!.info.canonical, undefined);
  assert.equal(added[0]!.info.integrationID, "gateway-catalog-testgw");
  assert.equal(added[0]!.models.length, 1);
  assert.equal(
    (added[0]!.info.settings as Record<string, unknown>)["baseURL"],
    "http://127.0.0.1:1/v1",
  );
});

test("does not overwrite a conflicting provider source (fail safe)", () => {
  const config = parseConfig({ baseURL: "http://127.0.0.1:1", providerId: "testgw" }).config;
  const { editor, added, updated, modelSets } = fakeEditor({
    package: "@opencode/ai/providers/openai",
    baseURL: "https://elsewhere.example/v1",
  });
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", sink: (_l, line) => lines.push(line) });
  registerCatalog(editor, state, config, logger);
  assert.equal(added.length, 0);
  assert.equal(updated.length, 0);
  assert.equal(modelSets.length, 0);
  assert.ok(lines.some((line) => line.includes("will not overwrite another provider source")));
});

test("safe-updates a provider record that is structurally our own source", () => {
  const config = parseConfig({ baseURL: "http://127.0.0.1:1", providerId: "testgw" }).config;
  const { editor, added, updated, modelSets } = fakeEditor({
    package: "@opencode/ai/providers/openai-compatible",
    baseURL: "http://127.0.0.1:1/v1",
  });
  const logger = createLogger({ level: "debug", sink: () => undefined });
  registerCatalog(editor, state, config, logger);
  assert.equal(added.length, 0);
  assert.equal(updated.length, 1);
  assert.deepEqual(modelSets, [{ providerID: "testgw", count: 1 }]);
});
