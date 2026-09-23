/**
 * Canonical `GatewayModel` -> OpenCode `Model.Info` mapping.
 *
 * This module performs NO enrichment:
 *  - no models.dev lookup
 *  - no model-name heuristics
 *  - no capability/limit/pricing guesses
 *  - no synthesized variants (only explicit gateway `effort_tiers` are mapped)
 *
 * Required OpenCode fields that the gateway does not provide cause the model to
 * be skipped (the default). The optimistic defaults that OpenCode applies to
 * unknown custom models (200k context / 32k output / tools+image) are
 * deliberately never used as metadata.
 *
 * `strictMetadata` controls the reporting severity of those skips only:
 *  - true (default): missing/invalid required metadata is a warning
 *  - false: the same models are still skipped, but reported at info level
 * It never means "make something up". `[]`, `false` and synthetic limits are
 * not valid fallbacks for unknown metadata.
 */
import type { Model } from "@opencode/plugin";
import type { GatewayModel } from "./adapters/types.js";
export interface SkippedModel {
    readonly id: string;
    readonly reason: string;
    readonly missing: readonly string[];
    readonly severity: "warning" | "info";
}
export interface MappedCatalog {
    readonly models: Model.Info[];
    readonly skipped: SkippedModel[];
}
export interface MapOptions {
    readonly providerId: string;
    readonly strictMetadata: boolean;
}
interface SurfaceVerdict {
    readonly supported: boolean;
    readonly reason?: string;
}
/**
 * Surface filter based exclusively on explicit gateway fields:
 * `type`, `surface`, `supported_endpoints` and `output_modalities`.
 * Model ids and names are never inspected.
 */
export declare function isSupportedSurface(model: GatewayModel): SurfaceVerdict;
export declare function mapGatewayModel(model: GatewayModel, options: MapOptions): {
    readonly ok: true;
    readonly info: Model.Info;
} | {
    readonly ok: false;
    readonly skipped: SkippedModel;
};
export declare function mapGatewayCatalog(models: readonly GatewayModel[], options: MapOptions): MappedCatalog;
export {};
//# sourceMappingURL=mapper.d.ts.map