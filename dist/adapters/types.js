/**
 * Adapter abstraction.
 *
 * Adapters are responsible for turning a gateway-specific payload into the
 * canonical `GatewayModel` shape. Future gateways (LiteLLM, generic
 * OpenAI-compatible, NewAPI...) only need to implement this interface; the
 * OpenCode mapping, caching, refresh and lifecycle code is shared.
 */
export {};
//# sourceMappingURL=types.js.map