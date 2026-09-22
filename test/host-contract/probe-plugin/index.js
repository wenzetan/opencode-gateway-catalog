/**
 * Test-only probe plugin. It is NOT part of the published package (`files`
 * only includes `dist`).
 *
 * It calls the official `ctx.model.list()` / `ctx.provider.list()` APIs from a
 * real OpenCode 2 host and serializes the observed catalog to a file, so tests
 * can assert the metadata that was actually injected by the gateway catalog
 * plugin (much more precise than `opencode models` output).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export default {
  id: "test.probe",
  async setup(ctx) {
    const outputPath = ctx.options && typeof ctx.options.outputPath === "string" ? ctx.options.outputPath : "";
    if (!outputPath) return;
    const providerID = ctx.options && typeof ctx.options.providerID === "string" ? ctx.options.providerID : "";
    const deadline = Date.now() + 90_000;
    let snapshot;
    for (;;) {
      const models = await ctx.model.list();
      const providers = await ctx.provider.list();
      const found = models.data.some((model) => String(model.providerID) === providerID);
      if (found || Date.now() > deadline) {
        snapshot = { providers: providers.data, models: models.data };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    return () => undefined;
  },
};
