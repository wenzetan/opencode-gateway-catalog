/**
 * Host contract tests: run the real OpenCode 2 server with the gateway catalog
 * plugin plus a test-only probe plugin that calls `ctx.model.list()` and
 * `ctx.provider.list()` and writes the observed catalog to disk.
 *
 * This verifies the metadata that actually reaches the OpenCode runtime, not
 * just the mock gateway payload.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fullModel, startMockGateway } from "../integration/mock-gateway.js";
import { startOpenCodeServer, waitFor } from "../integration/harness.js";

interface ProbeSnapshot {
  providers: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
}

test("ctx.model.list()/ctx.provider.list() observe exact injected metadata", async () => {
  const gateway = await startMockGateway({
    models: [
      fullModel({
        id: "vendor/probe-model",
        name: "Probe Model",
        family: "probe-family",
        context_length: 12_345,
        max_input_tokens: 12_000,
        max_output_tokens: 1_000,
        capabilities: { tool_calling: true, effort_tiers: ["low", "high"] },
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        pricing: { input: 0.5, output: 1.5, cached: 0.1, cache_creation: 0.2 },
      }),
      (() => {
        const incomplete = fullModel({
          id: "vendor/probe-incomplete",
          name: "Probe Incomplete",
          context_length: 1_000,
          capabilities: { tool_calling: true },
          input_modalities: ["text"],
          output_modalities: ["text"],
        });
        delete incomplete["max_output_tokens"];
        return incomplete;
      })(),
    ],
  });

  const dir = await mkdtemp(join(tmpdir(), "gwc-host-contract-"));
  const probeOutput = join(dir, "probe.json");
  const cacheDir = join(dir, "cache");

  const server = await startOpenCodeServer({
    plugins: [
      {
        package: `file://${join(process.cwd(), "dist")}`,
        options: {
          adapter: "omniroute",
          providerId: "hostgw",
          providerName: "Host Gateway",
          baseURL: gateway.url,
          apiKeyEnv: "HOST_GATEWAY_KEY",
          refreshIntervalMs: 0,
          cache: false,
          logLevel: "debug",
        },
      },
      {
        package: `file://${join(process.cwd(), "test/host-contract/probe-plugin")}`,
        options: { outputPath: probeOutput, providerID: "hostgw" },
      },
    ],
    env: { HOST_GATEWAY_KEY: "host-contract-secret" },
    cacheDir,
    startupTimeoutMs: 120_000,
  });

  try {
    const snapshot = await waitFor(
      "probe snapshot",
      async () => {
        try {
          return JSON.parse(await readFile(probeOutput, "utf8")) as ProbeSnapshot;
        } catch {
          return undefined;
        }
      },
      { timeoutMs: 120_000, intervalMs: 250 },
    );

    const provider = snapshot.providers.find((entry) => entry["id"] === "hostgw");
    assert.ok(provider, "hostgw provider must be visible through ctx.provider.list()");
    assert.equal(provider["activation"], "enabled");
    assert.equal(provider["package"], "@opencode/ai/providers/openai-compatible");
    assert.equal((provider["settings"] as Record<string, unknown>)["baseURL"], `${gateway.url}/v1`);

    const model = snapshot.models.find((entry) => entry["id"] === "vendor/probe-model");
    assert.ok(model, "probe model must be visible through ctx.model.list()");
    assert.equal(model["providerID"], "hostgw");
    assert.equal(model["modelID"], "vendor/probe-model");
    assert.equal(model["name"], "Probe Model");
    assert.equal(model["family"], "probe-family");
    assert.deepEqual(model["limit"], { context: 12_345, input: 12_000, output: 1_000 });
    assert.deepEqual(model["capabilities"], {
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    });
    assert.deepEqual(model["cost"], [
      { input: 0.5, output: 1.5, cache: { read: 0.1, write: 0.2 } },
    ]);
    assert.deepEqual(model["variants"], [
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ]);
    assert.equal(model["enabled"], true);
    assert.equal(model["status"], "active");

    // The incomplete model must not be registered at all.
    assert.equal(
      snapshot.models.find((entry) => entry["id"] === "vendor/probe-incomplete"),
      undefined,
    );
  } finally {
    await server.stop();
    await gateway.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
