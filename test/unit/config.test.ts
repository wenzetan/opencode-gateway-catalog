import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveApiBaseURL, parseConfig } from "../../src/config.js";
import { ConfigError } from "../../src/errors.js";

delete process.env["OPENCODE_GATEWAY_CATALOG_LOG_LEVEL"];

test("parseConfig applies documented defaults", () => {
  const { config } = parseConfig({ baseURL: "http://127.0.0.1:20128" });
  assert.equal(config.adapter, "omniroute");
  assert.equal(config.providerId, "omniroute");
  assert.equal(config.providerName, "OmniRoute");
  assert.equal(config.apiKeyEnv, "OMNIROUTE_API_KEY");
  assert.equal(config.gatewayRoot, "http://127.0.0.1:20128");
  assert.equal(config.apiBaseURL, "http://127.0.0.1:20128/v1");
  assert.equal(config.discoveryURL, "http://127.0.0.1:20128/v1/models");
  assert.equal(config.refreshIntervalMs, 300_000);
  assert.equal(config.timeoutMs, 10_000);
  assert.equal(config.maxResponseBytes, 16 * 1024 * 1024);
  assert.equal(config.cache, true);
  assert.equal(config.strictMetadata, true);
  assert.equal(config.logLevel, "info");
});

test("baseURL trailing slash does not produce double slashes", () => {
  const { config } = parseConfig({ baseURL: "http://127.0.0.1:20128/" });
  assert.equal(config.discoveryURL, "http://127.0.0.1:20128/v1/models");
  assert.ok(!config.discoveryURL.includes("//v1"));
});

test("baseURL path prefixes are preserved", () => {
  const { config } = parseConfig({ baseURL: "https://gateway.example.com/prefix" });
  assert.equal(config.apiBaseURL, "https://gateway.example.com/prefix/v1");
  assert.equal(config.discoveryURL, "https://gateway.example.com/prefix/v1/models");
});

test("baseURL already ending in /v1 is not duplicated", () => {
  const { config } = parseConfig({ baseURL: "http://host/prefix/v1" });
  assert.equal(config.apiBaseURL, "http://host/prefix/v1");
  assert.equal(config.discoveryURL, "http://host/prefix/v1/models");
});

test("explicit discoveryPath resolves under the gateway root prefix", () => {
  const { config } = parseConfig({
    baseURL: "https://gateway.example.com/prefix",
    discoveryPath: "/v1/models",
  });
  assert.equal(config.discoveryURL, "https://gateway.example.com/prefix/v1/models");
  assert.equal(config.discoveryPathLabel, "/prefix/v1/models");
});

test("deriveApiBaseURL keeps prefixes", () => {
  assert.equal(
    deriveApiBaseURL(new URL("https://host/a/b")).href.replace(/\/$/, ""),
    "https://host/a/b/v1",
  );
});

test("non-http schemes are rejected as fatal config errors", () => {
  for (const baseURL of ["file:///etc/passwd", "ftp://host", "not a url"]) {
    assert.throws(() => parseConfig({ baseURL }), ConfigError);
  }
});

test("credentials/query/fragment in baseURL are rejected", () => {
  for (const baseURL of ["http://user:pass@host", "http://host/?token=1", "http://host/#frag"]) {
    assert.throws(() => parseConfig({ baseURL }), ConfigError);
  }
});

test("providerId validation", () => {
  assert.throws(() => parseConfig({ baseURL: "http://h", providerId: "bad/id" }), ConfigError);
  assert.throws(() => parseConfig({ baseURL: "http://h", providerId: "" }), ConfigError);
  const { config } = parseConfig({ baseURL: "http://h", providerId: "omni-route_2" });
  assert.equal(config.providerId, "omni-route_2");
});

test("unsupported adapter is fatal", () => {
  assert.throws(() => parseConfig({ baseURL: "http://h", adapter: "litellm" }), ConfigError);
});

test("refreshIntervalMs accepts 0 (disabled) and rejects negatives", () => {
  assert.equal(
    parseConfig({ baseURL: "http://h", refreshIntervalMs: 0 }).config.refreshIntervalMs,
    0,
  );
  assert.throws(() => parseConfig({ baseURL: "http://h", refreshIntervalMs: -1 }), ConfigError);
  assert.throws(() => parseConfig({ baseURL: "http://h", refreshIntervalMs: 1.5 }), ConfigError);
});

test("timeoutMs and maxResponseBytes validation", () => {
  assert.throws(() => parseConfig({ baseURL: "http://h", timeoutMs: 0 }), ConfigError);
  assert.throws(() => parseConfig({ baseURL: "http://h", maxResponseBytes: 10 }), ConfigError);
  assert.equal(parseConfig({ baseURL: "http://h", timeoutMs: 250 }).config.timeoutMs, 250);
});

test("apiKeyEnv can be disabled explicitly", () => {
  assert.equal(parseConfig({ baseURL: "http://h", apiKeyEnv: null }).config.apiKeyEnv, null);
  assert.equal(parseConfig({ baseURL: "http://h", apiKeyEnv: "" }).config.apiKeyEnv, null);
});

test("explicit apiKey warns but keeps env name for documentation", () => {
  const parsed = parseConfig({ baseURL: "http://h", apiKey: "sekret" });
  assert.equal(parsed.config.apiKey, "sekret");
  assert.ok(parsed.warnings.some((warning) => warning.includes("apiKeyEnv")));
});

test("unknown options produce warnings, not failures", () => {
  const parsed = parseConfig({ baseURL: "http://h", typoOption: 1 });
  assert.ok(parsed.warnings.some((warning) => warning.includes("typoOption")));
});

test("logLevel validation", () => {
  assert.equal(parseConfig({ baseURL: "http://h", logLevel: "debug" }).config.logLevel, "debug");
  assert.throws(() => parseConfig({ baseURL: "http://h", logLevel: "verbose" }), ConfigError);
});

test("missing options or baseURL is fatal", () => {
  assert.throws(() => parseConfig(undefined), ConfigError);
  assert.throws(() => parseConfig({}), ConfigError);
  assert.throws(() => parseConfig("nope"), ConfigError);
});
