#!/usr/bin/env node
/**
 * Verifies that the OpenCode 2 catalog injected by the plugin matches the raw
 * `GET /v1/models` payload of a real OmniRoute gateway, field by field.
 *
 * Required environment:
 *   OPCODE_URL       e.g. http://127.0.0.1:48123
 *   OPCODE_PASSWORD  server password for Basic auth
 *   RAW_MODELS_FILE  path to the raw /v1/models JSON response
 *
 * Optional environment:
 *   PROVIDER_ID      provider id used by the plugin (default: omniroute-dynamic)
 *   VERIFY_TIMEOUT_MS defaults to 120000
 *
 * Exit code 0 means: every registered model matches the gateway metadata and
 * every omitted model was omitted for one of the documented strict reasons.
 */

import { readFileSync } from "node:fs";

const url = process.env.OPCODE_URL;
const password = process.env.OPCODE_PASSWORD;
const rawModelsFile = process.env.RAW_MODELS_FILE;
const providerID = process.env.PROVIDER_ID ?? "omniroute-dynamic";
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS ?? 120_000);

if (!url || !password || !rawModelsFile) {
  console.error("OPCODE_URL, OPCODE_PASSWORD and RAW_MODELS_FILE are required");
  process.exit(2);
}

const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;

async function api(path) {
  const response = await fetch(`${url}${path}`, { headers: { authorization: auth } });
  if (response.status !== 200) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

async function waitForCatalog() {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const body = await api("/api/model");
      const models = (body.data ?? []).filter((model) => String(model.providerID) === providerID);
      if (models.length > 0) return models;
    } catch {
      // server not ready yet
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for provider ${providerID} to expose models`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const positiveInt = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const nonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;
const stringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "")
    ? value
    : undefined;

function expectedCost(pricing) {
  if (pricing === undefined || pricing === null) return [];
  const numbers = [pricing.input, pricing.output, pricing.cached, pricing.cache_creation];
  if (numbers.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return [
      {
        input: pricing.input,
        output: pricing.output,
        cache: { read: pricing.cached, write: pricing.cache_creation },
      },
    ];
  }
  return [];
}

function unsupportedReason(raw) {
  const context = positiveInt(raw.context_length);
  const output = positiveInt(raw.max_output_tokens);
  const tools = typeof raw.capabilities?.tool_calling === "boolean";
  const input = stringArray(raw.input_modalities);
  const outputModalities = stringArray(raw.output_modalities);
  const reasons = [];
  if (context === undefined) reasons.push("context_length missing/invalid");
  if (output === undefined) reasons.push("max_output_tokens missing/invalid");
  if (!tools) reasons.push("capabilities.tool_calling missing/invalid");
  if (input === undefined || input.length === 0) reasons.push("input_modalities missing/empty");
  if (outputModalities === undefined || outputModalities.length === 0) {
    reasons.push("output_modalities missing/empty");
  } else if (!outputModalities.includes("text")) {
    reasons.push("output_modalities has no text");
  }
  return reasons.length > 0 ? reasons.join("; ") : undefined;
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const raw = JSON.parse(readFileSync(rawModelsFile, "utf8"));
const rawData = Array.isArray(raw.data) ? raw.data : [];
const rawById = new Map(rawData.map((item) => [String(item.id), item]));

const registered = await waitForCatalog();
const registeredIds = new Set(registered.map((model) => String(model.id)));

const failures = [];
const checked = [];

for (const model of registered) {
  const id = String(model.id);
  const item = rawById.get(id);
  if (!item) {
    failures.push(`${id}: registered but not present in /v1/models`);
    continue;
  }
  const expectName = nonEmptyString(item.name) ?? id;
  const expectFamily = nonEmptyString(item.family);
  const expectInput = positiveInt(item.max_input_tokens);
  const checks = [
    ["modelID", model.modelID, id],
    ["name", model.name, expectName],
    ["family", model.family, expectFamily],
    ["limit.context", model.limit?.context, positiveInt(item.context_length)],
    ["limit.input", model.limit?.input, expectInput],
    ["limit.output", model.limit?.output, positiveInt(item.max_output_tokens)],
    ["capabilities.tools", model.capabilities?.tools, item.capabilities?.tool_calling],
    ["capabilities.input", model.capabilities?.input, stringArray(item.input_modalities)],
    ["capabilities.output", model.capabilities?.output, stringArray(item.output_modalities)],
    ["cost", model.cost, expectedCost(item.pricing)],
    ["variants", model.variants, []],
  ];
  for (const [field, actual, expected] of checks) {
    if (!equal(actual, expected)) {
      failures.push(
        `${id}: ${field} mismatch: opencode=${JSON.stringify(actual)} gateway=${JSON.stringify(expected)}`,
      );
    }
  }
  checked.push({ id, item, model });
}

for (const item of rawData) {
  const id = String(item.id);
  if (registeredIds.has(id)) continue;
  const reason = unsupportedReason(item);
  if (reason === undefined) {
    failures.push(
      `${id}: omitted by the plugin but its metadata looks complete (${JSON.stringify(item).slice(0, 200)})`,
    );
  }
}

console.log(`provider: ${providerID}`);
console.log(`gateway models: ${rawData.length}`);
console.log(`registered models: ${registered.length}`);
console.log(`verified field-by-field: ${checked.length}`);
console.log(`omitted by strict metadata: ${rawData.length - registered.length}`);

const sampleSelectors = [
  (entry) => entry.model.capabilities?.input?.includes("image"),
  (entry) => entry.item.capabilities?.reasoning === true,
  (entry) => Array.isArray(entry.model.cost) && entry.model.cost.length > 0,
  (entry) => String(entry.id).includes("/"),
  () => true,
];
const samples = [];
for (const selector of sampleSelectors) {
  const found = checked.find((entry) => !samples.includes(entry) && selector(entry));
  if (found) samples.push(found);
}

console.log("\nsample consistency check (Gateway /v1/models -> ctx.model.list):");
for (const { id, item, model } of samples) {
  console.log(
    `- ${id}: context=${item.context_length}=${model.limit?.context} input=${item.max_input_tokens ?? "-"}=${model.limit?.input ?? "-"} output=${item.max_output_tokens}=${model.limit?.output} tools=${item.capabilities?.tool_calling}=${model.capabilities?.tools} in=${JSON.stringify(item.input_modalities)}=${JSON.stringify(model.capabilities?.input)} out=${JSON.stringify(item.output_modalities)}=${JSON.stringify(model.capabilities?.output)}`,
  );
}

if (process.env.SAMPLE_OUT && checked.length > 0) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.SAMPLE_OUT, `${checked[0].id}\n`);
}

if (failures.length > 0) {
  console.error("\nmetadata mismatches:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  "\nOK: every registered model matches GET /v1/models exactly; omissions are strict-mode skips.",
);
