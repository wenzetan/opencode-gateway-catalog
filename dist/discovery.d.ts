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
export interface FetchJsonOptions {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
    readonly maxBytes: number;
    readonly fetchImpl: typeof fetch;
    readonly signal?: AbortSignal;
}
export declare function fetchJson(options: FetchJsonOptions): Promise<unknown>;
//# sourceMappingURL=discovery.d.ts.map