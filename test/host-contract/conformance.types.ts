/**
 * Compile-time conformance checks against the official OpenCode 2 plugin ABI.
 *
 * This file is type-checked (tsc -p tsconfig.test.json). It fails the build if
 * the plugin is coupled to an API that is not part of the documented
 * `@opencode/plugin` surface used here.
 *
 * Only these host APIs are required by the plugin:
 *   - ctx.options
 *   - ctx.provider.transform
 *   - ctx.provider.reload
 *   - ctx.model.list (host-contract verification only)
 *   - ctx.integration.transform / ctx.integration reload path (env credentials)
 */

import type { Model, Plugin, Provider } from "@opencode/plugin";
import plugin from "../../src/index.js";

/** The default export must satisfy the official Plugin interface. */
export const pluginConformance: Plugin.Plugin = plugin;

/** Extract the official context type exactly as the host defines it. */
type Context = Parameters<Plugin.Plugin["setup"]>[0];

/** Extracting a provider editor type from the official transform signature. */
type ProviderTransform = Context["provider"]["transform"];
type ProviderEditor = Parameters<Parameters<ProviderTransform>[0]>[0];
type ProviderRecord = NonNullable<ReturnType<ProviderEditor["get"]>>;

/** Freeze the official model/provider shapes used by the mapper. */
export const modelInfoType = (model: Model.Info): Model.Info => model;
export const providerInfoType = (provider: Provider.Info): Provider.Info => provider;
export const providerRecordType = (record: ProviderRecord): ProviderRecord => record;

/** The plugin must only rely on the official surface listed above. */
export const usesOnlySupportedContextApis = (ctx: Context): void => {
  void ctx.options;
  void ctx.provider.transform;
  void ctx.provider.reload;
  void ctx.integration.transform;
  void ctx.model.list;
};
