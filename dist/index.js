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
import { createOmniRouteAdapter } from "./adapters/omniroute.js";
import { DiskCache } from "./cache.js";
import { parseConfig } from "./config.js";
import { describeError } from "./errors.js";
import { createLogger } from "./logger.js";
import { CatalogController } from "./refresh.js";
export const PLUGIN_ID = "gateway.catalog";
export const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
export function createAdapter(config) {
    switch (config.adapter) {
        case "omniroute":
            return createOmniRouteAdapter();
    }
}
export function integrationIdFor(config) {
    return `gateway-catalog-${config.providerId}`;
}
export function usesEnvIntegration(config) {
    return config.apiKey === undefined && config.apiKeyEnv !== null;
}
export function buildProviderInfo(config) {
    const settings = { baseURL: config.apiBaseURL };
    if (config.apiKey !== undefined) {
        // Explicit key mode. `apiKeyEnv` is the recommended mode: the key stays in
        // the environment and is resolved by the runtime at request time.
        settings["apiKey"] = config.apiKey;
    }
    return {
        id: config.providerId,
        name: config.providerName,
        activation: "enabled",
        package: OPENAI_COMPATIBLE_PACKAGE,
        settings: settings,
        ...(usesEnvIntegration(config)
            ? { integrationID: integrationIdFor(config) }
            : {}),
    };
}
function isOwnProvider(record, config) {
    const provider = record.provider;
    if (provider.package !== OPENAI_COMPATIBLE_PACKAGE)
        return false;
    const settings = provider.settings;
    return settings?.["baseURL"] === config.apiBaseURL;
}
/**
 * Synchronous, cheap and repeatable: reads the in-memory catalog snapshot and
 * registers provider + models. No IO happens here (see refresh.ts).
 */
export function registerCatalog(editor, state, config, logger) {
    const providerId = config.providerId;
    const existing = editor.get(providerId);
    if (existing !== undefined && !isOwnProvider(existing, config)) {
        logger.error(`provider "${providerId}" already exists (package=${existing.provider.package ?? "unknown"}); ` +
            `Gateway Catalog will not overwrite another provider source. Remove the static ` +
            `providers.${providerId} block or configure a different providerId.`);
        return;
    }
    const info = buildProviderInfo(config);
    const models = state.models;
    logger.debug(`transform: provider=${providerId} models=${models.length} existing=${existing === undefined ? "no" : "yes"}`);
    if (existing === undefined) {
        editor.add({ info, models });
        logger.debug(`transform: registered provider=${providerId} with ${models.length} model(s)`);
        return;
    }
    editor.update(providerId, (provider) => {
        provider.name = info.name;
        provider.activation = info.activation;
        provider.package = info.package;
        provider.settings = { ...provider.settings, ...info.settings };
    });
    editor.models.set(providerId, models);
}
const plugin = {
    id: PLUGIN_ID,
    async setup(context) {
        let parsed;
        try {
            parsed = parseConfig(context.options);
        }
        catch (error) {
            // Configuration errors are fatal: the plugin refuses to activate. The
            // OpenCode server keeps running and other plugins are unaffected.
            createLogger({ level: "error" }).error(`invalid configuration: ${describeError(error)}`);
            throw error;
        }
        const { config, warnings } = parsed;
        const logger = createLogger({ level: config.logLevel });
        for (const warning of warnings)
            logger.warn(warning);
        logger.debug(`adapter=${config.adapter} provider=${config.providerId} gatewayRoot=${config.gatewayRoot} apiBaseURL=${config.apiBaseURL} discoveryURL=${config.discoveryURL}`);
        const adapter = createAdapter(config);
        const cache = config.cache ? new DiskCache({ logger }) : undefined;
        const controller = new CatalogController({
            adapter,
            config,
            logger,
            cache,
            fetchImpl: fetch,
            now: () => new Date(),
            onCatalogChanged: () => context.provider.reload(),
        });
        if (usesEnvIntegration(config)) {
            const integrationId = integrationIdFor(config);
            await context.integration.transform((editor) => {
                editor.update(integrationId, (integration) => {
                    integration.name = config.providerName;
                });
                if (config.apiKeyEnv !== null) {
                    editor.method.update({
                        integrationID: integrationId,
                        method: { type: "env", names: [config.apiKeyEnv] },
                    });
                }
            });
            logger.debug(`registered env integration ${integrationId} for ${config.apiKeyEnv}`);
        }
        // Load first, then register a transform that only reads the in-memory
        // snapshot (recommended lifecycle pattern).
        await controller.initialize();
        await context.provider.transform((editor) => {
            try {
                registerCatalog(editor, controller.getState(), config, logger);
            }
            catch (error) {
                logger.error(`transform failed: ${describeError(error)}`);
                throw error;
            }
        });
        let timer;
        if (config.refreshIntervalMs > 0) {
            timer = setInterval(() => {
                void controller.refresh("timer");
            }, config.refreshIntervalMs);
            timer.unref?.();
            logger.debug(`background refresh every ${config.refreshIntervalMs} ms`);
        }
        return () => {
            if (timer !== undefined)
                clearInterval(timer);
            controller.dispose();
            logger.debug(`provider=${config.providerId} plugin unloaded; timers and in-flight requests cleaned up`);
        };
    },
};
export default plugin;
//# sourceMappingURL=index.js.map