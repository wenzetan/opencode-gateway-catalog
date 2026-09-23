/**
 * OmniRoute adapter.
 *
 * OmniRoute is the source of truth for model metadata: this file only performs
 * transport-facing parsing and strict field validation. It never enriches,
 * infers or "fixes" metadata. Missing or malformed fields stay missing.
 */
import type { GatewayAdapter } from "./types.js";
export declare function createOmniRouteAdapter(): GatewayAdapter;
//# sourceMappingURL=omniroute.d.ts.map