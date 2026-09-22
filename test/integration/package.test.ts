/**
 * Package artifact test: `npm pack` the plugin, install the tarball into an
 * isolated directory, load the installed artifact through a real OpenCode 2
 * server and verify the published contents.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fullModel, startMockGateway } from "./mock-gateway.js";
import { startOpenCodeServer, waitFor } from "./harness.js";

const exec = promisify(execFile);

test("npm pack artifact installs, imports and loads in OpenCode 2", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "gwc-pack-"));
  try {
    const { stdout: packOutput } = await exec(
      "npm",
      ["pack", "--pack-destination", workDir, "--json"],
      { cwd: process.cwd() },
    );
    const packInfo = JSON.parse(packOutput) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;
    const tarballName = packInfo[0]!.filename;
    const tarballPath = join(workDir, tarballName);

    // Published contents must be limited to dist + docs.
    const files = packInfo[0]!.files.map((file) => file.path).sort();
    assert.ok(
      files.some((file) => file.startsWith("dist/")),
      "dist files missing from tarball",
    );
    assert.ok(files.includes("README.md"));
    assert.ok(files.includes("LICENSE"));
    assert.ok(files.includes("package.json"));
    for (const file of files) {
      assert.ok(!file.startsWith("test/"), `test file leaked into tarball: ${file}`);
      assert.ok(!file.startsWith(".tmp"), `temp file leaked into tarball: ${file}`);
      assert.ok(!file.startsWith("scripts/"), `scripts leaked into tarball: ${file}`);
      assert.ok(!file.includes(".env"), `env file leaked into tarball: ${file}`);
    }

    // Install the tarball into an isolated prefix.
    const appDir = join(workDir, "app");
    await exec(
      "npm",
      ["install", "--prefix", appDir, tarballPath, "--no-audit", "--no-fund", "--ignore-scripts"],
      {
        cwd: workDir,
      },
    );
    const installedDir = join(appDir, "node_modules", "opencode-gateway-catalog");
    const installedPackage = JSON.parse(
      await readFile(join(installedDir, "package.json"), "utf8"),
    ) as { type?: string; exports?: Record<string, unknown>; main?: string };
    assert.equal(installedPackage.type, "module");
    assert.ok(installedPackage.exports?.["."], "exports[.] missing from installed package");
    assert.ok(await stat(join(installedDir, "dist", "index.js")));

    // The installed artifact must import without the OpenCode plugin package
    // being present (types-only dependency, zero runtime dependencies).
    const module = (await import(`file://${join(installedDir, "dist", "index.js")}`)) as {
      default: { id?: string; setup?: unknown };
    };
    assert.equal(module.default.id, "gateway.catalog");
    assert.equal(typeof module.default.setup, "function");
    const indexSource = await readFile(join(installedDir, "dist", "index.js"), "utf8");
    assert.ok(
      !indexSource.includes('from "@opencode/plugin"'),
      "runtime import of @opencode/plugin found in dist/index.js",
    );
    assert.ok(!indexSource.includes("@opencode-ai/plugin"), "legacy plugin ABI reference found");

    // Load the installed artifact through a real OpenCode 2 server.
    const gateway = await startMockGateway({
      models: [
        fullModel({
          id: "vendor/packed-model",
          name: "Packed Model",
          context_length: 5_000,
          max_output_tokens: 500,
          capabilities: { tool_calling: true },
          input_modalities: ["text"],
          output_modalities: ["text"],
        }),
      ],
    });
    const server = await startOpenCodeServer({
      plugins: [
        {
          package: `file://${join(installedDir, "dist")}`,
          options: {
            adapter: "omniroute",
            providerId: "packed",
            providerName: "Packed Gateway",
            baseURL: gateway.url,
            apiKeyEnv: null,
            refreshIntervalMs: 0,
            cache: false,
            logLevel: "debug",
          },
        },
      ],
      cacheDir: join(workDir, "cache"),
    });
    try {
      await waitFor(
        "packed model to appear",
        async () => {
          const response = await fetch(`${server.url}/api/model`, {
            headers: {
              authorization: `Basic ${Buffer.from(`opencode:${server.password}`).toString("base64")}`,
            },
          });
          const body = (await response.json()) as { data?: Array<{ id?: string }> };
          return body.data?.some((model) => model.id === "vendor/packed-model") ? true : undefined;
        },
        { timeoutMs: 60_000 },
      );
    } finally {
      await server.stop();
      await gateway.stop();
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
