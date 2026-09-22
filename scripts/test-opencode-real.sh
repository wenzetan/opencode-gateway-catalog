#!/usr/bin/env bash
#
# Real-gateway acceptance test: OpenCode 2 + opencode-gateway-catalog + a live
# OmniRoute instance.
#
# Usage:
#   OMNIROUTE_API_KEY=... scripts/test-opencode-real.sh
#
# Optional environment:
#   OMNIROUTE_URL      default http://127.0.0.1:20128
#   GW_PROVIDER_ID     default omniroute-dynamic (use "omniroute" in production
#                      after removing static providers.omniroute.models)
#   OPENCODE_BIN       default opencode
#   GW_RUN=1           also run a single low-cost inference request
#   GW_KEEP=1          keep the temporary directory for inspection
#
# The script never prints the API key and never writes it to disk.

set -euo pipefail

OMNIROUTE_URL="${OMNIROUTE_URL:-http://127.0.0.1:20128}"
GW_PROVIDER_ID="${GW_PROVIDER_ID:-omniroute-dynamic}"
OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
PLUGIN_PATH="${PLUGIN_PATH:-file://$(cd "$(dirname "$0")/.." && pwd)/dist}"
export PLUGIN_PATH
GW_RUN="${GW_RUN:-0}"
GW_KEEP="${GW_KEEP:-0}"

export OMNIROUTE_URL GW_PROVIDER_ID

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 1
  }
}

need node
need curl
need "$OPENCODE_BIN"

TMP="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "$GW_KEEP" = "1" ]; then
    echo "temporary files kept at: $TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

echo "==> checking gateway: $OMNIROUTE_URL/v1/models"
AUTH_HEADER=()
if [ -n "${OMNIROUTE_API_KEY:-}" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${OMNIROUTE_API_KEY}")
fi
HTTP_CODE="$(curl -sS -o "$TMP/models.json" -w '%{http_code}' "${AUTH_HEADER[@]}" "$OMNIROUTE_URL/v1/models")"
if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: GET /v1/models returned HTTP $HTTP_CODE" >&2
  exit 1
fi
MODEL_COUNT="$(node -e "const d=require('$TMP/models.json'); console.log(Array.isArray(d.data)?d.data.length:'invalid')")"
echo "    gateway reachable, models=$MODEL_COUNT"

echo "==> OpenCode version"
"$OPENCODE_BIN" --version

PORT="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
OPENCODE_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
export OPENCODE_PASSWORD
export OPCODE_PASSWORD="$OPENCODE_PASSWORD"
# The plugin does not use models.dev; disabling the built-in fetch speeds up
# startup and removes network noise from the acceptance test.
export OPENCODE_DISABLE_MODELS_FETCH=1

CONFIG_CONTENT="$(node -e "
const options = {
  adapter: 'omniroute',
  providerId: process.env.GW_PROVIDER_ID,
  providerName: 'OmniRoute',
  baseURL: process.env.OMNIROUTE_URL,
  apiKeyEnv: process.env.OMNIROUTE_API_KEY ? 'OMNIROUTE_API_KEY' : null,
  refreshIntervalMs: 5000,
  timeoutMs: 10000,
  cache: true,
  logLevel: 'info',
};
console.log(JSON.stringify({ \$schema: 'https://opencode.ai/config.json', plugins: [{ package: process.env.PLUGIN_PATH, options }] }));
")"
export OPENCODE_CONFIG_CONTENT="$CONFIG_CONTENT"

echo "==> starting OpenCode server on port $PORT (isolated virtual config)"
"$OPENCODE_BIN" serve --port "$PORT" --print-logs > "$TMP/serve.log" 2>&1 &
SERVER_PID=$!

sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "ERROR: OpenCode server exited early:" >&2
  tail -40 "$TMP/serve.log" >&2
  exit 1
fi

export OPCODE_URL="http://127.0.0.1:$PORT"
export RAW_MODELS_FILE="$TMP/models.json"
export PROVIDER_ID="$GW_PROVIDER_ID"
export SAMPLE_OUT="$TMP/sample-id.txt"

echo "==> waiting for plugin catalog and verifying metadata against /v1/models"
if ! node "$(dirname "$0")/verify-omniroute-metadata.mjs"; then
  echo "--- server log tail ---" >&2
  tail -60 "$TMP/serve.log" >&2
  exit 1
fi

if grep -q 'Plugin failed to load' "$TMP/serve.log" 2>/dev/null; then
  echo "ERROR: server reported a plugin load failure" >&2
  exit 1
fi

if [ "$GW_RUN" = "1" ]; then
  SAMPLE_ID="$(cat "$TMP/sample-id.txt")"
  echo "==> single inference request through $GW_PROVIDER_ID/$SAMPLE_ID"
  "$OPENCODE_BIN" run --server "$OPCODE_URL" --model "$GW_PROVIDER_ID/$SAMPLE_ID" "Reply exactly: OK"
  echo "==> inference completed"
else
  echo "==> skipping inference (set GW_RUN=1 to run one low-cost request)"
fi

echo "==> real gateway acceptance test passed"
