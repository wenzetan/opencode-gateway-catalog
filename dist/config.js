/**
 * Plugin option parsing, validation and URL derivation.
 *
 * URLs are derived with the WHATWG `URL` class (never string concatenation) so
 * that a gateway mounted under a path prefix such as
 * `https://gateway.example.com/prefix` keeps its prefix.
 */
import { ConfigError } from "./errors.js";
import { parseLogLevel } from "./logger.js";
export const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024; // 16 MiB
export const DEFAULT_API_KEY_ENV = "OMNIROUTE_API_KEY";
export const DEFAULT_DISCOVERY_PATH = "/v1/models";
export const DEFAULT_REFRESH_INTERVAL_MS = 300_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KNOWN_OPTION_KEYS = new Set([
    "adapter",
    "providerId",
    "providerName",
    "baseURL",
    "apiKey",
    "apiKeyEnv",
    "discoveryPath",
    "refreshIntervalMs",
    "timeoutMs",
    "cache",
    "strictMetadata",
    "maxResponseBytes",
    "logLevel",
]);
function readOptionalString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function readBooleanOption(value, name, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "boolean")
        throw new ConfigError(`"${name}" must be a boolean`);
    return value;
}
function readIntOption(value, name, fallback, min) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
        throw new ConfigError(`"${name}" must be a finite safe integer`);
    }
    if (value < min)
        throw new ConfigError(`"${name}" must be >= ${min}`);
    return value;
}
function trimTrailingSlashes(pathname) {
    const trimmed = pathname.replace(/\/+$/, "");
    return trimmed.length === 0 ? "/" : trimmed;
}
function ensureTrailingSlash(url) {
    const copy = new URL(url.href);
    if (!copy.pathname.endsWith("/"))
        copy.pathname = `${copy.pathname}/`;
    return copy;
}
function parseGatewayRoot(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ConfigError(`"baseURL" is not a valid URL: ${raw}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ConfigError(`"baseURL" must use http: or https: (got ${url.protocol})`);
    }
    if (url.username !== "" || url.password !== "") {
        throw new ConfigError('"baseURL" must not embed credentials');
    }
    if (url.search !== "" || url.hash !== "") {
        throw new ConfigError('"baseURL" must not contain a query string or fragment');
    }
    url.pathname = trimTrailingSlashes(url.pathname);
    return url;
}
/** `http://host` -> `http://host/v1`; `http://host/prefix` -> `http://host/prefix/v1`. */
export function deriveApiBaseURL(gatewayRoot) {
    const copy = new URL(gatewayRoot.href);
    const path = trimTrailingSlashes(copy.pathname);
    if (path === "/v1" || path.endsWith("/v1")) {
        copy.pathname = path;
        return copy;
    }
    copy.pathname = path === "/" ? "/v1" : `${path}/v1`;
    return copy;
}
function deriveDiscoveryURL(gatewayRoot, apiBaseURL, discoveryPath) {
    if (discoveryPath === undefined) {
        // Default: <apiBaseURL>/models. Keeps the base path prefix intact.
        return new URL("models", ensureTrailingSlash(apiBaseURL));
    }
    const path = discoveryPath.trim();
    if (path.length === 0)
        throw new ConfigError('"discoveryPath" must not be empty');
    // Explicit discovery paths are relative to the configured gateway root. A
    // leading slash is tolerated and is still resolved under the prefix.
    const relative = path.replace(/^\/+/, "");
    let url;
    try {
        url = new URL(relative, ensureTrailingSlash(gatewayRoot));
    }
    catch {
        throw new ConfigError(`"discoveryPath" is not a valid path: ${discoveryPath}`);
    }
    if (url.origin !== gatewayRoot.origin) {
        throw new ConfigError('"discoveryPath" must stay on the configured baseURL origin');
    }
    if (url.search !== "" || url.hash !== "") {
        throw new ConfigError('"discoveryPath" must not contain a query string or fragment');
    }
    return url;
}
export function parseConfig(rawOptions) {
    if (rawOptions === null || rawOptions === undefined) {
        throw new ConfigError('plugin options are required (at minimum "baseURL")');
    }
    if (typeof rawOptions !== "object" || Array.isArray(rawOptions)) {
        throw new ConfigError("plugin options must be an object");
    }
    const options = rawOptions;
    const warnings = [];
    const adapterRaw = options["adapter"];
    const adapter = adapterRaw === undefined ? "omniroute" : adapterRaw;
    if (adapter !== "omniroute") {
        throw new ConfigError(`unsupported adapter "${String(adapterRaw)}" (supported: "omniroute")`);
    }
    const baseURL = readOptionalString(options["baseURL"]);
    if (baseURL === undefined)
        throw new ConfigError('"baseURL" is required and must be a non-empty string');
    let providerId;
    if (options["providerId"] === undefined) {
        providerId = "omniroute";
    }
    else {
        const parsed = readOptionalString(options["providerId"]);
        if (parsed === undefined) {
            throw new ConfigError('"providerId" must be a non-empty string');
        }
        providerId = parsed;
    }
    if (!PROVIDER_ID_PATTERN.test(providerId) || providerId.length > 64) {
        throw new ConfigError(`"providerId" must match ${PROVIDER_ID_PATTERN.source} and be at most 64 chars`);
    }
    const providerName = readOptionalString(options["providerName"]) ??
        (adapter === "omniroute" ? "OmniRoute" : providerId);
    const gatewayRoot = parseGatewayRoot(baseURL);
    const apiBase = deriveApiBaseURL(gatewayRoot);
    const discoveryURL = deriveDiscoveryURL(gatewayRoot, apiBase, readOptionalString(options["discoveryPath"]));
    const apiKey = readOptionalString(options["apiKey"]);
    let apiKeyEnv;
    if (options["apiKeyEnv"] === null) {
        apiKeyEnv = null;
    }
    else if (options["apiKeyEnv"] === undefined) {
        apiKeyEnv = DEFAULT_API_KEY_ENV;
    }
    else {
        apiKeyEnv = readOptionalString(options["apiKeyEnv"]) ?? null;
    }
    if (apiKey !== undefined && apiKeyEnv !== null) {
        warnings.push(`explicit "apiKey" takes precedence over environment variable "${apiKeyEnv}"; ` +
            'prefer "apiKeyEnv" so the key stays out of the configuration file');
    }
    const refreshIntervalMs = readIntOption(options["refreshIntervalMs"], "refreshIntervalMs", DEFAULT_REFRESH_INTERVAL_MS, 0);
    const timeoutMs = readIntOption(options["timeoutMs"], "timeoutMs", DEFAULT_TIMEOUT_MS, 1);
    const maxResponseBytes = readIntOption(options["maxResponseBytes"], "maxResponseBytes", DEFAULT_MAX_RESPONSE_BYTES, 1024);
    const cache = readBooleanOption(options["cache"], "cache", true);
    const strictMetadata = readBooleanOption(options["strictMetadata"], "strictMetadata", true);
    const envLevel = parseLogLevel(process.env["OPENCODE_GATEWAY_CATALOG_LOG_LEVEL"]);
    const configuredLevel = parseLogLevel(options["logLevel"]);
    if (options["logLevel"] !== undefined && configuredLevel === undefined) {
        throw new ConfigError('"logLevel" must be one of "debug" | "info" | "warn" | "error"');
    }
    const logLevel = configuredLevel ?? envLevel ?? "info";
    for (const key of Object.keys(options)) {
        if (!KNOWN_OPTION_KEYS.has(key))
            warnings.push(`unknown option "${key}" is ignored`);
    }
    return {
        config: {
            adapter,
            providerId,
            providerName,
            gatewayRoot: gatewayRoot.href.replace(/\/$/, ""),
            apiBaseURL: apiBase.href.replace(/\/$/, ""),
            discoveryURL: discoveryURL.href,
            discoveryPathLabel: discoveryURL.pathname,
            apiKey,
            apiKeyEnv,
            refreshIntervalMs,
            timeoutMs,
            maxResponseBytes,
            cache,
            strictMetadata,
            logLevel,
        },
        warnings,
    };
}
//# sourceMappingURL=config.js.map