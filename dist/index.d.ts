/**
 * opencode-gateway-catalog — OpenCode 2 plugin entry point.
 *
 * Discovers the model catalog of an OpenAI-compatible gateway (OmniRoute
 * first), validates it strictly and injects it into the OpenCode provider/model
 * catalog through `ctx.provider.transform`. The gateway is the only source of
 * metadata: this plugin never uses models.dev, never infers capabilities from
 * model names and never synthesizes reasoning variants (gateway-provided
 * `effort_tiers` are mapped verbatim).
 *
 * The module only imports *types* from `@opencode/plugin`, so the published
 * artifact has no runtime dependency on the OpenCode plugin package. The host
 * provides the runtime; the exported object structurally satisfies the official
 * `Plugin` interface.
 */
import type { Plugin as PluginApi, Provider } from "@opencode/plugin";
import type { GatewayAdapter } from "./adapters/types.js";
import { type ResolvedConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { type CatalogState } from "./refresh.js";
export declare const PLUGIN_ID = "gateway.catalog";
export declare const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
type ProviderTransformCallback = Parameters<PluginApi.Context["provider"]["transform"]>[0];
type ProviderEditor = Parameters<ProviderTransformCallback>[0];
export declare function createAdapter(config: ResolvedConfig): GatewayAdapter;
export declare function integrationIdFor(config: ResolvedConfig): string;
export declare function usesEnvIntegration(config: ResolvedConfig): boolean;
export declare function buildProviderInfo(config: ResolvedConfig): Provider.Info;
/**
 * Synchronous, cheap and repeatable: reads the in-memory catalog snapshot and
 * registers provider + models. No IO happens here (see refresh.ts).
 */
export declare function registerCatalog(editor: ProviderEditor, state: CatalogState, config: ResolvedConfig, logger: ReturnType<typeof createLogger>): void;
declare const plugin: PluginApi.Plugin;
export default plugin;
//# sourceMappingURL=index.d.ts.map