/**
 * Real OpenCode 2 host harness for integration tests.
 *
 * Spawns the actual `opencode serve` binary with an isolated virtual config
 * (`OPENCODE_CONFIG_CONTENT`) so the developer's global config is never
 * modified, then talks to the v2 HTTP API with Basic auth.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";

export interface PluginConfig {
  readonly package: string;
  readonly options: Record<string, unknown>;
}

export interface ServerOptions {
  readonly plugins: readonly PluginConfig[];
  readonly env?: Record<string, string>;
  /** Extra top-level config merged into the virtual config document. */
  readonly config?: Record<string, unknown>;
  readonly startupTimeoutMs?: number;
  readonly cacheDir?: string;
}

export interface OpenCodeServer {
  readonly url: string;
  readonly port: number;
  readonly password: string;
  readonly logs: readonly string[];
  dumpLogs(): string;
  stop(): Promise<void>;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("failed to allocate port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function apiRequest(
  server: OpenCodeServer,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`opencode:${server.password}`).toString("base64")}`,
    accept: "application/json",
  };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`${server.url}${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // keep raw text
  }
  return { status: response.status, body: parsed };
}

export async function waitFor<T>(
  description: string,
  probe: () => Promise<T | undefined> | T | undefined,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const result = await probe();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const suffix = lastError === undefined ? "" : ` (last error: ${String(lastError)})`;
      throw new Error(`timed out waiting for ${description}${suffix}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface PluginInfo {
  readonly id?: string;
  readonly state?: { readonly status?: string; readonly error?: string };
}

interface PluginListResponse {
  readonly data?: readonly PluginInfo[];
}

interface ModelListResponse {
  readonly data?: readonly Record<string, unknown>[];
}

export async function startOpenCodeServer(options: ServerOptions): Promise<OpenCodeServer> {
  const port = await getFreePort();
  const password = `test-password-${port}`;
  const config = {
    $schema: "https://opencode.ai/config.json",
    plugins: options.plugins.map((plugin) => ({
      package: plugin.package,
      options: plugin.options,
    })),
    ...options.config,
  };
  const binary = process.env["OPENCODE_BIN"] ?? "opencode";
  const child = spawn(binary, ["serve", "--port", String(port), "--print-logs"], {
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_PASSWORD: password,
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_FILEWATCHER: "1",
      ...(options.cacheDir === undefined ? {} : { XDG_CACHE_HOME: options.cacheDir }),
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  const append = (chunk: Buffer): void => {
    logs.push(chunk.toString("utf8"));
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const server: OpenCodeServer = {
    url: `http://127.0.0.1:${port}`,
    port,
    password,
    get logs() {
      return logs;
    },
    dumpLogs: () => logs.join(""),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5000);
      await exited;
      clearTimeout(timer);
    },
  };

  // Wait for HTTP readiness first.
  try {
    await waitFor(
      "opencode server to accept requests",
      async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`opencode process exited early (code=${child.exitCode})`);
        }
        try {
          const response = await fetch(`${server.url}/api/plugin`, {
            headers: {
              authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
            },
          });
          return response.status === 200 ? true : undefined;
        } catch {
          return undefined;
        }
      },
      { timeoutMs: options.startupTimeoutMs ?? 120_000, intervalMs: 250 },
    );
  } catch (error) {
    throw new Error(`${String(error)}\n--- opencode logs ---\n${logs.join("")}`);
  }

  // Wait for every configured package plugin to reach a terminal state.
  await waitFor(
    "plugins to load",
    async () => {
      const response = await apiRequest(server, "/api/plugin");
      const body = response.body as PluginListResponse;
      const list = body.data ?? [];
      const nonBuiltin = list.filter((plugin) => {
        const record = plugin as unknown as { source?: { type?: string } };
        return record.source?.type !== "builtin";
      });
      if (nonBuiltin.length < options.plugins.length) return undefined;
      for (const plugin of nonBuiltin) {
        if (plugin.state?.status === "failed") {
          throw new Error(
            `plugin ${plugin.id ?? "?"} failed to load: ${plugin.state.error ?? "unknown"}`,
          );
        }
      }
      if (nonBuiltin.every((plugin) => plugin.state?.status === "active")) return true;
      return undefined;
    },
    { timeoutMs: options.startupTimeoutMs ?? 120_000, intervalMs: 250 },
  );

  return server;
}

export async function listModels(
  server: OpenCodeServer,
): Promise<readonly Record<string, unknown>[]> {
  const response = await apiRequest(server, "/api/model");
  if (response.status !== 200) throw new Error(`/api/model returned ${response.status}`);
  return (response.body as ModelListResponse).data ?? [];
}

export async function listProviders(
  server: OpenCodeServer,
): Promise<readonly Record<string, unknown>[]> {
  const response = await apiRequest(server, "/api/provider");
  if (response.status !== 200) throw new Error(`/api/provider returned ${response.status}`);
  return (response.body as { data?: readonly Record<string, unknown>[] }).data ?? [];
}

export async function modelIds(server: OpenCodeServer): Promise<string[]> {
  return (await listModels(server)).map((model) => String(model["id"]));
}
