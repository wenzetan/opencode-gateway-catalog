/**
 * Real OpenCode 2 host integration tests.
 *
 * Each test boots the actual `opencode serve` binary against the mock gateway
 * and asserts the observable v2 catalog/API behavior. No source-level mocking
 * of OpenCode is involved.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fullModel, startMockGateway, type MockGateway } from "./mock-gateway.js";
import {
  apiRequest,
  listModels,
  listProviders,
  modelIds,
  startOpenCodeServer,
  waitFor,
  type OpenCodeServer,
} from "./harness.js";

const PLUGIN_PATH = `file://${join(process.cwd(), "dist")}`;
const API_KEY = "test-gateway-secret-123";

function pluginConfig(baseURL: string, options: Record<string, unknown> = {}) {
  return [
    {
      package: PLUGIN_PATH,
      options: {
        adapter: "omniroute",
        providerId: "testgw",
        providerName: "Test Gateway",
        baseURL,
        apiKeyEnv: "TEST_GATEWAY_API_KEY",
        timeoutMs: 5000,
        cache: false,
        logLevel: "debug",
        ...options,
      },
    },
  ];
}

function findModel(
  models: readonly Record<string, unknown>[],
  id: string,
): Record<string, unknown> | undefined {
  return models.find((model) => String(model["id"]) === id);
}

async function runCli(
  server: OpenCodeServer,
  args: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const binary = process.env["OPENCODE_BIN"] ?? "opencode";
  return new Promise((resolve) => {
    const child = spawn(binary, [...args], {
      env: { ...process.env, OPENCODE_PASSWORD: server.password },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("catalog metadata, inference routing, auth, hot refresh and outage LKG", async () => {
  const modelA = fullModel({
    id: "vendor/model-a",
    name: "Vendor Model A",
    family: "vendor-a",
    context_length: 111_000,
    max_input_tokens: 100_000,
    max_output_tokens: 22_222,
    capabilities: { tool_calling: true, reasoning: true, effort_tiers: ["low", "high"] },
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    pricing: { input: 1.5, output: 2.5, cached: 0.5, cache_creation: 3 },
  });
  const modelB = fullModel({
    id: "vendor/model-b",
    name: "Vendor Model B",
    context_length: 64_000,
    max_input_tokens: 60_000,
    max_output_tokens: 4_096,
    capabilities: { tool_calling: false, vision: true },
    input_modalities: ["text"],
    output_modalities: ["text"],
  });
  const modelC = fullModel({
    id: "vendor/model-c",
    name: "Vendor Model C",
    context_length: 32_000,
    max_output_tokens: 2_048,
    capabilities: { tool_calling: true },
    input_modalities: ["text"],
    output_modalities: ["text"],
  });
  const gateway: MockGateway = await startMockGateway({
    models: [
      modelA,
      modelB,
      (() => {
        const incomplete = fullModel({
          id: "vendor/missing-output",
          name: "Missing Output",
          context_length: 128_000,
          capabilities: { tool_calling: true },
          input_modalities: ["text"],
          output_modalities: ["text"],
        });
        delete incomplete["max_output_tokens"];
        delete incomplete["max_input_tokens"];
        return incomplete;
      })(),
      fullModel({
        id: "vendor/vision-name-only",
        name: "super-vision-gpt-claude-reasoning-coder",
        context_length: 128_000,
        max_output_tokens: 8_192,
        capabilities: { tool_calling: true },
        input_modalities: ["text"],
        output_modalities: ["text"],
      }),
      fullModel({
        id: "vendor/image-only",
        name: "Image Only",
        context_length: 128_000,
        max_output_tokens: 8_192,
        capabilities: { tool_calling: false },
        input_modalities: ["text"],
        output_modalities: ["image"],
      }),
    ],
  });
  const cacheDir = await mkdtemp(join(tmpdir(), "gwc-it-cache-"));
  const server = await startOpenCodeServer({
    plugins: pluginConfig(gateway.url, { refreshIntervalMs: 1000, cache: true }),
    env: { TEST_GATEWAY_API_KEY: API_KEY },
    cacheDir,
  });

  try {
    // ---- catalog: registered models and exact metadata -------------------
    const models = await listModels(server);
    const registeredA = findModel(models, "vendor/model-a");
    assert.ok(registeredA, `vendor/model-a not found in ${(await modelIds(server)).join(", ")}`);
    assert.equal(registeredA["modelID"], "vendor/model-a");
    assert.equal(registeredA["providerID"], "testgw");
    assert.equal(registeredA["name"], "Vendor Model A");
    assert.equal(registeredA["family"], "vendor-a");
    assert.deepEqual(registeredA["limit"], { context: 111_000, input: 100_000, output: 22_222 });
    assert.deepEqual(registeredA["capabilities"], {
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    });
    assert.deepEqual(registeredA["cost"], [
      { input: 1.5, output: 2.5, cache: { read: 0.5, write: 3 } },
    ]);

    // goal field "max_output_tokens" is required; incomplete models are skipped
    assert.equal(findModel(models, "vendor/missing-output"), undefined);
    // no model-name heuristics: "vision" in the name does not add "image"
    const nameOnly = findModel(models, "vendor/vision-name-only");
    assert.ok(nameOnly);
    assert.deepEqual((nameOnly["capabilities"] as Record<string, unknown>)["input"], ["text"]);
    // explicit non-text output surface is filtered out
    assert.equal(findModel(models, "vendor/image-only"), undefined);
    // vision flag without input_modalities never invents image capability
    const registeredB = findModel(models, "vendor/model-b");
    assert.ok(registeredB);
    assert.deepEqual((registeredB["capabilities"] as Record<string, unknown>)["input"], ["text"]);
    assert.equal((registeredB["capabilities"] as Record<string, unknown>)["tools"], false);

    // provider registration
    const providers = await listProviders(server);
    const testgw = providers.find((provider) => provider["id"] === "testgw");
    assert.ok(testgw);
    assert.equal(testgw["activation"], "enabled");
    assert.equal((testgw["settings"] as Record<string, unknown>)["baseURL"], `${gateway.url}/v1`);
    assert.equal(testgw["canonical"], undefined, "must not set a canonical provider");
    assert.equal(
      (testgw["sourceConnection"] as Record<string, unknown> | undefined)?.type,
      undefined,
      "env credentials must be declared through an integration, not a dangling sourceConnection",
    );

    // ---- real inference through opencode run ------------------------------
    gateway.clearRequests();
    const run = await runCli(server, [
      "run",
      "--server",
      server.url,
      "--model",
      "testgw/vendor/model-a",
      "reply exactly OK",
    ]);
    assert.equal(run.code, 0, `opencode run failed: ${run.stderr}\n${run.stdout}`);
    assert.match(run.stdout, /OK/);

    const inferenceRequests = gateway.requests.filter(
      (request) => request.path === "/v1/chat/completions",
    );
    assert.ok(inferenceRequests.length >= 1, "mock gateway did not receive the inference request");
    const chatRequest = inferenceRequests[inferenceRequests.length - 1]!;
    const body = chatRequest.body as Record<string, unknown>;
    assert.equal(body["model"], "vendor/model-a", "raw gateway model id must be sent on the wire");
    assert.equal(chatRequest.headers["authorization"], `Bearer ${API_KEY}`);
    // The plugin never proxies streams: the request went straight from the
    // OpenCode runtime to the mock gateway.

    // ---- hot refresh: add a model without restarting OpenCode -------------
    gateway.setModels([modelA, modelB, modelC]);

    await waitFor(
      "vendor/model-c to appear after hot refresh",
      async () => {
        const current = await listModels(server);
        return findModel(current, "vendor/model-c") === undefined ? undefined : true;
      },
      { timeoutMs: 45_000, intervalMs: 500 },
    );

    // ---- hot refresh: removing a model removes it from the catalog --------
    gateway.setModels([modelA]);
    await waitFor(
      "vendor/model-c to disappear after hot refresh",
      async () => {
        const current = await listModels(server);
        return findModel(current, "vendor/model-c") === undefined ? true : undefined;
      },
      { timeoutMs: 45_000, intervalMs: 500 },
    );

    // ---- outage: 503 keeps the last-known-good catalog --------------------
    gateway.setFailure(503);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const duringOutage = await listModels(server);
    assert.ok(findModel(duringOutage, "vendor/model-a"), "model-a must survive a gateway outage");

    // single-flight: never more than one concurrent discovery request
    assert.equal(gateway.maxConcurrentDiscovery, 1);
  } finally {
    await server.stop();
    await gateway.stop();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("unauthenticated gateway works without an API key env", async () => {
  const gateway = await startMockGateway({
    models: [
      fullModel({
        id: "open/model-a",
        name: "Open Model",
        context_length: 10_000,
        max_output_tokens: 1_000,
        capabilities: { tool_calling: true },
        input_modalities: ["text"],
        output_modalities: ["text"],
      }),
    ],
  });
  const cacheDir = await mkdtemp(join(tmpdir(), "gwc-unauth-cache-"));
  const server = await startOpenCodeServer({
    plugins: pluginConfig(gateway.url, {
      providerId: "testgw-noauth",
      apiKeyEnv: null,
      refreshIntervalMs: 0,
    }),
    cacheDir,
  });
  try {
    const models = await listModels(server);
    assert.ok(findModel(models, "open/model-a"));
    gateway.clearRequests();
    const run = await runCli(server, [
      "run",
      "--server",
      server.url,
      "--model",
      "testgw-noauth/open/model-a",
      "reply exactly OK",
    ]);
    assert.equal(run.code, 0, `${run.stderr}\n${run.stdout}`);
    const chat = gateway.requests.find((request) => request.path === "/v1/chat/completions");
    assert.ok(chat);
    assert.equal((chat.body as Record<string, unknown>)["model"], "open/model-a");
    assert.equal(
      chat.headers["authorization"],
      undefined,
      "no Authorization for unauthenticated gateway",
    );
  } finally {
    await server.stop();
    await gateway.stop();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("startup outage restores the disk cache and never fails the plugin", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gwc-lkg-cache-"));
  const online = await startMockGateway({
    models: [
      fullModel({
        id: "vendor/cached",
        name: "Cached Model",
        context_length: 7_000,
        max_output_tokens: 700,
        capabilities: { tool_calling: true },
        input_modalities: ["text"],
        output_modalities: ["text"],
      }),
    ],
  });

  // First boot populates the persistent cache.
  const firstServer = await startOpenCodeServer({
    plugins: pluginConfig(online.url, {
      providerId: "testgw-lkg",
      refreshIntervalMs: 0,
      cache: true,
    }),
    cacheDir,
  });
  try {
    await waitFor("cached model to appear", async () =>
      findModel(await listModels(firstServer), "vendor/cached") ? true : undefined,
    );
  } finally {
    await firstServer.stop();
  }
  await online.stop();

  // Second boot: gateway is offline, cache must be restored and plugin active.
  const offlineServer = await startOpenCodeServer({
    plugins: pluginConfig(online.url, {
      providerId: "testgw-lkg",
      refreshIntervalMs: 0,
      cache: true,
    }),
    cacheDir,
  });
  try {
    const plugins = await apiRequest(offlineServer, "/api/plugin");
    const list =
      (plugins.body as { data?: readonly { id?: string; state?: { status?: string } }[] }).data ??
      [];
    assert.ok(
      list.some((plugin) => plugin.id === "gateway.catalog" && plugin.state?.status === "active"),
      "plugin must stay active when the gateway is offline",
    );
    await waitFor(
      "cached model to be restored",
      async () => (findModel(await listModels(offlineServer), "vendor/cached") ? true : undefined),
      { timeoutMs: 30_000 },
    );
    assert.match(offlineServer.dumpLogs(), /discovery failed/);
    assert.match(offlineServer.dumpLogs(), /restored .* from cache/);
  } finally {
    await offlineServer.stop();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("startup outage without cache still loads the plugin with zero models", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gwc-nocache-"));
  const server = await startOpenCodeServer({
    plugins: pluginConfig("http://127.0.0.1:1", {
      providerId: "testgw-nocache",
      refreshIntervalMs: 0,
      cache: false,
      logLevel: "debug",
    }),
    cacheDir,
  });
  try {
    const plugins = await apiRequest(server, "/api/plugin");
    const list =
      (plugins.body as { data?: readonly { id?: string; state?: { status?: string } }[] }).data ??
      [];
    assert.ok(
      list.some((plugin) => plugin.id === "gateway.catalog" && plugin.state?.status === "active"),
    );
    const providers = await listProviders(server);
    const provider = providers.find((entry) => entry["id"] === "testgw-nocache");
    assert.ok(provider, "provider must still be registered (empty catalog)");
    const models = await listModels(server);
    assert.equal(findModel(models, "anything"), undefined);
    assert.match(server.dumpLogs(), /has no models/);
  } finally {
    await server.stop();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
