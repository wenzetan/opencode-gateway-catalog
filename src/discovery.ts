/**
 * HTTP transport for catalog discovery.
 *
 * Requirements implemented here:
 *  - HTTP timeout via AbortController
 *  - response size limit (default 16 MiB) enforced while streaming
 *  - status validation (401/403 are authentication errors)
 *  - JSON parsing, with malformed payloads treated as recoverable errors
 *  - credentials are only ever placed in request headers; headers and API keys
 *    are never logged
 */

import { AuthenticationError, DiscoveryError } from "./errors.js";

export interface FetchJsonOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
}

function safeUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  urlLabel: string,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DiscoveryError(
        `response from ${urlLabel} is too large (${declared} bytes > ${maxBytes} bytes)`,
      );
    }
  }
  if (response.body === null) {
    throw new DiscoveryError(`response from ${urlLabel} has no body`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new DiscoveryError(
          `response from ${urlLabel} exceeded the ${maxBytes} byte limit while streaming`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received).toString("utf8");
}

export async function fetchJson(options: FetchJsonOptions): Promise<unknown> {
  const urlLabel = safeUrlForLog(options.url);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  const onExternalAbort = (): void => controller.abort();
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw new DiscoveryError(`discovery request to ${urlLabel} was aborted`);
    }
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: "GET",
      headers: { ...options.headers },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (error) {
    if (timedOut) {
      throw new DiscoveryError(`request to ${urlLabel} timed out after ${options.timeoutMs} ms`, {
        cause: error,
      });
    }
    if (options.signal?.aborted === true) {
      throw new DiscoveryError(`discovery request to ${urlLabel} was aborted`, { cause: error });
    }
    throw new DiscoveryError(`request to ${urlLabel} failed`, { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  if (response.status === 401 || response.status === 403) {
    // Drain the body to free the socket; never inspect the response body for secrets.
    await response.body?.cancel().catch(() => undefined);
    throw new AuthenticationError(
      `gateway rejected the request with HTTP ${response.status} (check your API key)`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new DiscoveryError(`gateway returned HTTP ${response.status}`);
  }

  const text = await readBodyWithLimit(response, options.maxBytes, urlLabel);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new DiscoveryError(`gateway returned malformed JSON`, { cause: error });
  }
}
