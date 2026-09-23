/**
 * Adapter abstraction.
 *
 * Adapters are responsible for turning a gateway-specific payload into the
 * canonical `GatewayModel` shape. Future gateways (LiteLLM, generic
 * OpenAI-compatible, NewAPI...) only need to implement this interface; the
 * OpenCode mapping, caching, refresh and lifecycle code is shared.
 */

export interface GatewayPricing {
  readonly input?: number;
  readonly output?: number;
  readonly cached?: number;
  readonly cacheCreation?: number;
  readonly reasoning?: number;
}

export interface GatewayModel {
  readonly id: string;

  readonly name?: string;
  readonly family?: string;

  readonly contextLength?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;

  readonly toolCalling?: boolean;

  readonly inputModalities?: readonly string[];
  readonly outputModalities?: readonly string[];

  readonly vision?: boolean;
  readonly reasoning?: boolean;
  readonly thinking?: boolean;

  /** Gateway-provided reasoning effort levels, in gateway order. Never synthesized. */
  readonly effortTiers?: readonly string[];

  readonly pricing?: GatewayPricing;

  /** Explicit surface hints from the gateway; only used when the gateway provides them. */
  readonly supportedEndpoints?: readonly string[];
  readonly surface?: string;
  readonly type?: string;

  /** Original gateway item. Never logged, never cached. */
  readonly raw?: unknown;
}

export interface ModelIssue {
  readonly id: string;
  readonly kind: "invalid";
  readonly field: string;
  readonly detail: string;
}

export interface ParseResult {
  readonly models: readonly GatewayModel[];
  /** Per-model field problems (invalid types / values). Missing fields are detected by the mapper. */
  readonly issues: readonly ModelIssue[];
}

export interface AdapterContext {
  readonly baseURL: string;
  readonly apiBaseURL: string;
  readonly discoveryURL: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface GatewayAdapter {
  readonly id: string;
  /** Fetch (or otherwise obtain) and parse the catalog. Throws recoverable errors on failure. */
  discover(context: AdapterContext): Promise<ParseResult>;
  /** Pure parser used by `discover` and by cache restore tests. */
  parse(payload: unknown): ParseResult;
}
