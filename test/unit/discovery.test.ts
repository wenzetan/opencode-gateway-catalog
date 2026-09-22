import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJson } from "../../src/discovery.js";
import { AuthenticationError, DiscoveryError } from "../../src/errors.js";

const baseOptions = {
  timeoutMs: 1000,
  maxBytes: 1024 * 1024,
  url: "http://gateway.test/v1/models",
};

test("fetchJson sends the provided headers and parses JSON", async () => {
  let seen: RequestInit | undefined;
  const payload = { object: "list", data: [{ id: "x" }] };
  const result = await fetchJson({
    ...baseOptions,
    headers: { Authorization: "Bearer super-secret", Accept: "application/json" },
    fetchImpl: (async (_url, init) => {
      seen = init;
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch,
  });
  assert.deepEqual(result, payload);
  const headers = new Headers(seen?.headers);
  assert.equal(headers.get("authorization"), "Bearer super-secret");
});

test("401 and 403 produce AuthenticationError without leaking the key", async () => {
  for (const status of [401, 403]) {
    const error = await fetchJson({
      ...baseOptions,
      headers: { Authorization: "Bearer super-secret" },
      fetchImpl: (async () => new Response("nope", { status })) as typeof fetch,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof AuthenticationError);
    assert.ok(!String(error).includes("super-secret"));
  }
});

test("HTTP 500 produces a recoverable DiscoveryError", async () => {
  const error = await fetchJson({
    ...baseOptions,
    headers: {},
    fetchImpl: (async () => new Response("boom", { status: 503 })) as typeof fetch,
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof DiscoveryError);
  assert.match(String(error), /503/);
});

test("timeout aborts the request and produces a DiscoveryError", async () => {
  const error = await fetchJson({
    ...baseOptions,
    timeoutMs: 20,
    headers: {},
    fetchImpl: ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch,
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof DiscoveryError);
  assert.match(String(error), /timed out/);
});

test("malformed JSON produces a DiscoveryError", async () => {
  const error = await fetchJson({
    ...baseOptions,
    headers: {},
    fetchImpl: (async () => new Response("{ not json", { status: 200 })) as typeof fetch,
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof DiscoveryError);
  assert.match(String(error), /malformed JSON/);
});

test("content-length over the limit is rejected before reading", async () => {
  const error = await fetchJson({
    ...baseOptions,
    maxBytes: 32,
    headers: {},
    fetchImpl: (async () =>
      new Response("x".repeat(100), {
        status: 200,
        headers: { "content-length": "100" },
      })) as typeof fetch,
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof DiscoveryError);
  assert.match(String(error), /too large/);
});

test("streaming body over the limit is rejected", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(64)));
      controller.close();
    },
  });
  const error = await fetchJson({
    ...baseOptions,
    maxBytes: 32,
    headers: {},
    fetchImpl: (async () => new Response(stream, { status: 200 })) as typeof fetch,
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof DiscoveryError);
  assert.match(String(error), /exceeded/);
});
