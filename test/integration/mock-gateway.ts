/**
 * Test-only OpenAI-compatible mock gateway.
 *
 * Implements:
 *  - GET  /v1/models               (configurable catalog)
 *  - POST /v1/chat/completions     (SSE streaming, OpenAI-compatible)
 *  - GET  /health
 *
 * Captures every inference request (method, path, headers, JSON body) so tests
 * can assert: the model id sent on the wire, the Authorization header and that
 * the plugin never proxies the chat stream itself.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockModel extends Record<string, unknown> {
  id: string;
}

export interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly at: number;
}

export interface MockGatewayOptions {
  readonly port?: number;
  readonly models?: readonly MockModel[];
  readonly failureStatus?: number;
  readonly failureBody?: string;
  /** Artificial latency before responding to discovery, in ms. */
  readonly discoveryDelayMs?: number;
}

export interface MockGateway {
  readonly url: string;
  readonly port: number;
  readonly requests: readonly CapturedRequest[];
  setModels(models: readonly MockModel[]): void;
  setFailure(status: number | undefined, body?: string): void;
  setDiscoveryDelay(ms: number): void;
  clearRequests(): void;
  /** In-flight discovery request count (used by single-flight tests). */
  readonly discoveryInFlight: number;
  readonly maxConcurrentDiscovery: number;
  stop(): Promise<void>;
}

export function fullModel(overrides: Partial<MockModel> & { id: string }): MockModel {
  return {
    object: "model",
    owned_by: "mock-vendor",
    name: overrides.id,
    context_length: 100_000,
    max_input_tokens: 90_000,
    max_output_tokens: 8_000,
    input_modalities: ["text"],
    output_modalities: ["text"],
    capabilities: { tool_calling: true },
    ...overrides,
  };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function collectBody(request: IncomingMessage, limit = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

const COMPACTION_SUMMARY = `## Objective
- Test the mock gateway compaction path.

## Requirements
- (none)

## Decisions
- (none)

## Work State
### Completed
- (none)
### Active
- Mock compaction summary.
### Blocked
- (none)

## Next Move
1. (none)

## Relevant Files
- (none)
`;

function messagesToText(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return "";
  return messages
    .map((message) => {
      if (typeof message !== "object" || message === null) return "";
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") return content;
      try {
        return JSON.stringify(content);
      } catch {
        return "";
      }
    })
    .join("\n");
}

function isCompactionRequest(body: unknown): boolean {
  const text = messagesToText(body);
  return (
    text.includes("You MUST use this format") ||
    text.includes("## Work State") ||
    text.includes("required summary template")
  );
}

function sseChunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

export async function startMockGateway(options: MockGatewayOptions = {}): Promise<MockGateway> {
  let models: readonly MockModel[] = options.models ?? [];
  let failureStatus: number | undefined = options.failureStatus;
  let failureBody = options.failureBody ?? JSON.stringify({ error: { message: "mock failure" } });
  let discoveryDelayMs = options.discoveryDelayMs ?? 0;
  let discoveryInFlight = 0;
  let maxConcurrentDiscovery = 0;
  const requests: CapturedRequest[] = [];

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value.join(", ");
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        discoveryInFlight += 1;
        maxConcurrentDiscovery = Math.max(maxConcurrentDiscovery, discoveryInFlight);
        try {
          if (discoveryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, discoveryDelayMs));
          }
          if (failureStatus !== undefined) {
            response.writeHead(failureStatus, { "content-type": "application/json" });
            response.end(failureBody);
            return;
          }
          sendJson(response, 200, { object: "list", data: models });
        } finally {
          discoveryInFlight -= 1;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const raw = await collectBody(request);
        let body: unknown;
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          body = raw;
        }
        requests.push({
          method: request.method,
          path: url.pathname,
          headers,
          body,
          at: Date.now(),
        });
        if (failureStatus !== undefined) {
          response.writeHead(failureStatus, { "content-type": "application/json" });
          response.end(failureBody);
          return;
        }
        const streamRequested =
          typeof body === "object" &&
          body !== null &&
          (body as { stream?: unknown }).stream === true;
        if (!streamRequested) {
          sendJson(response, 200, {
            id: "chatcmpl-mock",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "mock",
            choices: [
              { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
            ],
          });
          return;
        }
        const content = isCompactionRequest(body) ? COMPACTION_SUMMARY : "OK";
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(sseChunk({ role: "assistant", content }, null));
        response.write(sseChunk({}, "stop"));
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      sendJson(response, 404, { error: { message: "not found" } });
    })().catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: { message: String(error) } });
      else response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("mock gateway failed to bind");
  const port = address.port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    get requests() {
      return requests;
    },
    setModels(next) {
      models = next;
    },
    setFailure(status, body) {
      failureStatus = status;
      if (body !== undefined) failureBody = body;
    },
    setDiscoveryDelay(ms) {
      discoveryDelayMs = ms;
    },
    clearRequests() {
      requests.length = 0;
    },
    get discoveryInFlight() {
      return discoveryInFlight;
    },
    get maxConcurrentDiscovery() {
      return maxConcurrentDiscovery;
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
