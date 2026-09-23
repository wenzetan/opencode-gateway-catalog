import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GatewayAdapter, GatewayModel, ParseResult } from "../../src/adapters/types.js";
import { DiskCache } from "../../src/cache.js";
import { parseConfig } from "../../src/config.js";
import { CatalogIntegrityError, DiscoveryError } from "../../src/errors.js";
import { createLogger, type LogLevel } from "../../src/logger.js";
import { canonicalState, CatalogController } from "../../src/refresh.js";

function model(id: string, overrides: Partial<GatewayModel> = {}): GatewayModel {
  return {
    id,
    contextLength: 1000,
    maxOutputTokens: 100,
    toolCalling: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
    ...overrides,
  };
}

function staticAdapter(initial: readonly GatewayModel[]): {
  adapter: GatewayAdapter;
  setModels(models: readonly GatewayModel[]): void;
  setFailure(error: Error | undefined): void;
  calls: number;
  delayMs: number;
} {
  let models = initial;
  let failure: Error | undefined;
  const state = {
    calls: 0,
    delayMs: 0,
    adapter: {
      id: "omniroute",
      parse: (payload: unknown): ParseResult => ({ models: payload as GatewayModel[], issues: [] }),
      async discover(): Promise<ParseResult> {
        state.calls += 1;
        if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        if (failure !== undefined) throw failure;
        return { models, issues: [] };
      },
    } as GatewayAdapter,
    setModels(next: readonly GatewayModel[]) {
      models = next;
    },
    setFailure(error: Error | undefined) {
      failure = error;
    },
  };
  return state;
}

interface HarnessOptions {
  models?: readonly GatewayModel[];
  cache?: DiskCache | undefined;
  refreshIntervalMs?: number;
  logLevel?: LogLevel;
  now?: () => Date;
  discoverDelayMs?: number;
}

function harness(options: HarnessOptions = {}) {
  const config = parseConfig({
    baseURL: "http://127.0.0.1:20128",
    providerId: "omniroute",
    cache: options.cache !== undefined,
    refreshIntervalMs: options.refreshIntervalMs ?? 0,
    logLevel: options.logLevel ?? "debug",
  }).config;
  const fake = staticAdapter(options.models ?? [model("vendor/a")]);
  fake.delayMs = options.discoverDelayMs ?? 0;
  const logLines: string[] = [];
  const logger = createLogger({
    level: options.logLevel ?? "debug",
    sink: (_level, line) => logLines.push(line),
  });
  let reloadCount = 0;
  const controller = new CatalogController({
    adapter: fake.adapter,
    config,
    logger,
    cache: options.cache,
    fetchImpl: fetch,
    now: options.now ?? (() => new Date("2026-01-01T00:00:00.000Z")),
    onCatalogChanged: async () => {
      reloadCount += 1;
    },
  });
  return {
    controller,
    fake,
    logLines,
    reloadCount: () => reloadCount,
    logger,
  };
}

test("initialize loads the live catalog and computes the state", async () => {
  const h = harness({ models: [model("vendor/a"), model("vendor/b")] });
  await h.controller.initialize();
  const state = h.controller.getState();
  assert.equal(state.source, "live");
  assert.deepEqual(
    state.models.map((info) => String(info.id)),
    ["vendor/a", "vendor/b"],
  );
  assert.equal(state.fetchedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(h.reloadCount(), 0, "initial registration must not call reload");
});

test("initialize falls back to empty state when gateway is down and no cache exists", async () => {
  const h = harness({ models: [model("vendor/a")] });
  h.fake.setFailure(new DiscoveryError("HTTP 503"));
  await h.controller.initialize();
  const state = h.controller.getState();
  assert.equal(state.source, "empty");
  assert.deepEqual(state.models, []);
  assert.ok(h.logLines.some((line) => line.includes("no models")));
  assert.ok(h.logLines.some((line) => line.includes("discovery failed")));
});

test("refresh failure keeps the last-known-good catalog", async () => {
  const h = harness({ models: [model("vendor/a")] });
  await h.controller.initialize();
  h.fake.setFailure(new DiscoveryError("HTTP 503"));
  await h.controller.refresh("timer");
  const state = h.controller.getState();
  assert.equal(state.source, "live");
  assert.deepEqual(
    state.models.map((info) => String(info.id)),
    ["vendor/a"],
  );
  assert.ok(h.logLines.some((line) => line.includes("keeping last-known-good")));
});

test("refresh adds and removes models and triggers reload only on change", async () => {
  const h = harness({ models: [model("vendor/a")] });
  await h.controller.initialize();

  h.fake.setModels([model("vendor/a"), model("vendor/b")]);
  await h.controller.refresh("timer");
  assert.equal(h.reloadCount(), 1);
  assert.deepEqual(
    h.controller.getState().models.map((info) => String(info.id)),
    ["vendor/a", "vendor/b"],
  );

  // Unchanged catalog must not reload.
  await h.controller.refresh("timer");
  assert.equal(h.reloadCount(), 1);

  h.fake.setModels([model("vendor/a")]);
  await h.controller.refresh("timer");
  assert.equal(h.reloadCount(), 2);
  assert.deepEqual(
    h.controller.getState().models.map((info) => String(info.id)),
    ["vendor/a"],
  );
});

test("changing only effort tiers triggers a reload", async () => {
  const h = harness({ models: [model("vendor/a")] });
  await h.controller.initialize();

  h.fake.setModels([model("vendor/a", { effortTiers: ["low", "high"] })]);
  await h.controller.refresh("timer");
  assert.equal(h.reloadCount(), 1, "variant change must trigger a reload");
  assert.deepEqual(
    h.controller.getState().models[0]?.variants.map((variant) => String(variant.id)),
    ["low", "high"],
  );

  // Same variants again must not reload.
  await h.controller.refresh("timer");
  assert.equal(h.reloadCount(), 1);
});

test("malformed refresh payload keeps last-known-good (integrity error)", async () => {
  const h = harness({ models: [model("vendor/a")] });
  await h.controller.initialize();
  h.fake.setFailure(new CatalogIntegrityError("duplicate model id"));
  await h.controller.refresh("timer");
  assert.deepEqual(
    h.controller.getState().models.map((info) => String(info.id)),
    ["vendor/a"],
  );
});

test("single-flight refresh coalesces concurrent callers", async () => {
  const h = harness({ models: [model("vendor/a")], discoverDelayMs: 60 });
  await h.controller.initialize();
  const first = h.controller.refresh("timer");
  const second = h.controller.refresh("manual");
  const third = h.controller.refresh("startup");
  await Promise.all([first, second, third]);
  assert.equal(h.fake.calls, 2, "one initialize + exactly one coalesced refresh");
});

test("catalog comparison ignores gateway ordering and stale data", async () => {
  const h = harness({ models: [model("vendor/a"), model("vendor/b")] });
  await h.controller.initialize();
  h.fake.setModels([model("vendor/b"), model("vendor/a")]);
  await h.controller.refresh("timer");
  assert.equal(h.reloadCount(), 0, "same catalog in different order must not reload");
});

test("canonicalState is deterministic", async () => {
  const h = harness({ models: [model("vendor/a")] });
  await h.controller.initialize();
  const first = canonicalState(h.controller.getState());
  const second = canonicalState({ ...h.controller.getState() });
  assert.equal(first, second);
});

test("initialize restores a valid disk cache when discovery fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gwc-refresh-cache-"));
  try {
    const cached = [model("vendor/cached")];
    const writeHarness = harness({ models: cached, cache: undefined });
    // Write a cache entry directly using the same identity as the controller.
    const logger = createLogger({ level: "debug", sink: () => undefined });
    const cache = new DiskCache({ dir, logger });
    await cache.write(
      { adapter: "omniroute", providerId: "omniroute", baseURL: "http://127.0.0.1:20128/v1" },
      cached,
      "2025-12-31T00:00:00.000Z",
    );
    void writeHarness;

    const h = harness({ models: [model("vendor/live")], cache });
    h.fake.setFailure(new DiscoveryError("offline"));
    await h.controller.initialize();
    const state = h.controller.getState();
    assert.equal(state.source, "cache");
    assert.equal(state.fetchedAt, "2025-12-31T00:00:00.000Z");
    assert.deepEqual(
      state.models.map((info) => String(info.id)),
      ["vendor/cached"],
    );
    assert.ok(h.logLines.some((line) => line.includes("restored")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dispose prevents further refreshes", async () => {
  const h = harness({ models: [model("vendor/a")] });
  await h.controller.initialize();
  h.controller.dispose();
  await h.controller.refresh("manual");
  assert.equal(h.fake.calls, 1);
});
