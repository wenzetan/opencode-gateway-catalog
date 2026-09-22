import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cacheFileName, DiskCache, serializeCachedModels } from "../../src/cache.js";
import type { GatewayModel } from "../../src/adapters/types.js";
import { createLogger, type LogLevel } from "../../src/logger.js";

const identity = {
  adapter: "omniroute",
  providerId: "omniroute",
  baseURL: "http://127.0.0.1:20128/v1",
};

function testLogger(level: LogLevel = "debug") {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    sink: (_level, line) => lines.push(line),
  });
  return { logger, lines };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gwc-cache-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const models: GatewayModel[] = [
  {
    id: "vendor/a",
    name: "A",
    family: "fam-a",
    contextLength: 1000,
    maxInputTokens: 900,
    maxOutputTokens: 100,
    toolCalling: true,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    pricing: { input: 1, output: 2, cached: 0.5, cacheCreation: 3 },
  },
  {
    id: "vendor/b",
    contextLength: 2000,
    maxOutputTokens: 200,
    toolCalling: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
  },
];

test("round-trips canonical models", async () => {
  await withTempDir(async (dir) => {
    const { logger } = testLogger();
    const cache = new DiskCache({ dir, logger });
    await cache.write(identity, models, "2026-01-01T00:00:00.000Z");
    const entry = await cache.read(identity);
    assert.ok(entry);
    assert.equal(entry.fetchedAt, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(entry.models, models);
  });
});

test("cache key is isolated by adapter/providerId/baseURL", async () => {
  const other = { ...identity, baseURL: "http://127.0.0.1:20129/v1" };
  assert.notEqual(cacheFileName(identity), cacheFileName(other));
  assert.notEqual(cacheFileName(identity), cacheFileName({ ...identity, providerId: "preprod" }));
  assert.notEqual(cacheFileName(identity), cacheFileName({ ...identity, adapter: "other" }));
  await withTempDir(async (dir) => {
    const { logger } = testLogger();
    const cache = new DiskCache({ dir, logger });
    await cache.write(identity, models, "2026-01-01T00:00:00.000Z");
    assert.equal(await cache.read(other), undefined);
  });
});

test("corrupt cache files are ignored with a warning", async () => {
  await withTempDir(async (dir) => {
    const { logger, lines } = testLogger();
    const cache = new DiskCache({ dir, logger });
    await writeFile(join(dir, cacheFileName(identity)), "{ truncated");
    assert.equal(await cache.read(identity), undefined);
    assert.ok(lines.some((line) => line.includes("corrupt")));
  });
});

test("identity mismatch inside the cache file is ignored", async () => {
  await withTempDir(async (dir) => {
    const { logger, lines } = testLogger();
    const cache = new DiskCache({ dir, logger });
    await writeFile(
      join(dir, cacheFileName(identity)),
      JSON.stringify({
        version: 1,
        adapter: identity.adapter,
        providerId: "someone-else",
        baseURL: identity.baseURL,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        models: [],
      }),
    );
    assert.equal(await cache.read(identity), undefined);
    assert.ok(lines.some((line) => line.includes("identity mismatch")));
  });
});

test("invalid model entries invalidate the cached catalog", async () => {
  await withTempDir(async (dir) => {
    const { logger } = testLogger();
    const cache = new DiskCache({ dir, logger });
    await writeFile(
      join(dir, cacheFileName(identity)),
      JSON.stringify({
        version: 1,
        adapter: identity.adapter,
        providerId: identity.providerId,
        baseURL: identity.baseURL,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        models: [{ id: "" }],
      }),
    );
    assert.equal(await cache.read(identity), undefined);
  });
});

test("serialized cache never contains secrets or raw gateway payloads", async () => {
  const withRaw: GatewayModel[] = [
    {
      ...models[0]!,
      raw: {
        id: "vendor/a",
        headers: { Authorization: "Bearer super-secret-token" },
        apiKey: "super-secret-token",
      },
    },
  ];
  const serialized = JSON.stringify(serializeCachedModels(withRaw));
  assert.ok(!serialized.includes("super-secret-token"));
  assert.ok(!serialized.includes("Authorization"));
  assert.ok(!serialized.includes("raw"));
});

test("write failure surfaces as a CacheError", async () => {
  await withTempDir(async (dir) => {
    const { logger } = testLogger();
    // Point the cache at a path that cannot be created because a file exists there.
    const filePath = join(dir, "not-a-dir");
    await writeFile(filePath, "x");
    const cache = new DiskCache({ dir: join(filePath, "nested"), logger });
    await assert.rejects(() => cache.write(identity, models, "2026-01-01T00:00:00.000Z"));
  });
});
