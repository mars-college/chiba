#!/bin/bash
set -euo pipefail

# Prefetch NAS-backed (stash-cached) media onto a Pi before launching gallery playlist mode.
#
# Typical usage:
#   ./scripts/pis/prefetch-stash.sh --registry ./scripts/pis/midterms-gallery-registry.local.toml --pi upper-west-4 --wait
#
# Notes:
# - Prefetch uses the Cable server endpoint on the Pi: POST /api/stash/prefetch
# - Status polling uses: GET /api/stash/status?channelId=...

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

load_env() {
  local f
  for f in "$REPO_ROOT/.env.pis.local" "$SCRIPT_DIR/.env.pis.local"; do
    if [ -f "$f" ]; then
      set -a
      # shellcheck disable=SC1090
      source "$f"
      set +a
    fi
  done
}
load_env

REGISTRY_PATH="$SCRIPT_DIR/registry.toml"
if [ ! -f "$REGISTRY_PATH" ] && [ -f "$SCRIPT_DIR/registry.local.toml" ]; then
  REGISTRY_PATH="$SCRIPT_DIR/registry.local.toml"
fi

PI_NAME=""
APPLY_ALL=0
WAIT=0
TIMEOUT_SEC=180
JOBS=1
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pis/prefetch-stash.sh --registry path --pi <pi-name> [--wait] [--timeout-sec N] [--dry-run]
  ./scripts/pis/prefetch-stash.sh --registry path --all [--jobs N] [--wait] [--timeout-sec N] [--dry-run]

Behavior:
  - Determines which channels to prefetch from the registry:
    1) [pis.<name>.cable] prefetch_channels = ["earl", ...] (preferred)
    2) otherwise falls back to [pis.<name>.cable] channel = "earl"
  - SSHes into the Pi and calls:
      POST http://localhost:<server_port>/api/stash/prefetch
  - With --wait, polls /api/stash/status until all items are cached (or timeout).
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --registry)
      REGISTRY_PATH="$2"
      shift 2
      ;;
    --registry=*)
      REGISTRY_PATH="${1#*=}"
      shift
      ;;
    --pi)
      PI_NAME="$2"
      shift 2
      ;;
    --pi=*)
      PI_NAME="${1#*=}"
      shift
      ;;
    --all)
      APPLY_ALL=1
      shift
      ;;
    --wait)
      WAIT=1
      shift
      ;;
    --timeout-sec)
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    --timeout-sec=*)
      TIMEOUT_SEC="${1#*=}"
      shift
      ;;
    --jobs)
      JOBS="$2"
      shift 2
      ;;
    --jobs=*)
      JOBS="${1#*=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      ;;
  esac
done

if [ ! -f "$REGISTRY_PATH" ]; then
  echo "Missing registry: $REGISTRY_PATH"
  exit 1
fi

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required to parse $REGISTRY_PATH"
  exit 1
fi

list_pis() {
  "$PYTHON_BIN" - "$REGISTRY_PATH" <<'PY'
import sys
try:
    import tomllib as toml_parser
except Exception:
    import tomli as toml_parser  # type: ignore

path = sys.argv[1]
with open(path, "rb") as f:
    data = toml_parser.load(f)
pis = data.get("pis", {}) or {}
for name in sorted(pis.keys()):
    print(name)
PY
}

eval_pi() {
  local name="$1"
  # shellcheck disable=SC2046
  "$PYTHON_BIN" - "$REGISTRY_PATH" "$name" <<'PY'
import sys
import shlex
import os
try:
    import tomllib as toml_parser
except Exception:
    import tomli as toml_parser  # type: ignore

path = sys.argv[1]
name = sys.argv[2]
with open(path, "rb") as f:
    data = toml_parser.load(f)

def q(val):
    return shlex.quote("" if val is None else str(val))

def suffix(name: str) -> str:
    out = []
    last_us = False
    for ch in (name or ""):
        is_ok = ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ("0" <= ch <= "9")
        if is_ok:
            out.append(ch.upper())
            last_us = False
        else:
            if not last_us:
                out.append("_")
                last_us = True
    s = "".join(out).strip("_")
    return s

def env_first(*keys: str) -> str:
    for k in keys:
        v = os.environ.get(k)
        if v:
            return v
    return ""

defaults = data.get("defaults", {}) or {}
pis = data.get("pis", {}) or {}
node = pis.get(name) or {}
pi_suffix = suffix(name)

def get_node(key, default=""):
    return node.get(key, defaults.get(key, default))

def get_str(section, key, default=""):
    raw = (node.get(section, {}) or {}).get(key, (defaults.get(section, {}) or {}).get(key, default))
    return raw if isinstance(raw, str) else default

def get_list(section, key):
    raw = (node.get(section, {}) or {}).get(key, (defaults.get(section, {}) or {}).get(key))
    if isinstance(raw, list):
        out = []
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
        return out
    return []

prefetch_channels = get_list("cable", "prefetch_channels")
if not prefetch_channels:
    ch = get_str("cable", "channel", "").strip()
    if ch:
        prefetch_channels = [ch]

out = {
    "PI_NAME": name,
    "PI_HOST": get_node("host"),
    "PI_USER": get_node("user", "pi"),
    "PI_PASSWORD": (
        (node.get("password") or "").strip()
        or (defaults.get("password") or "").strip()
        or env_first(f"CHIBA_PI_PASSWORD_{pi_suffix}", "CHIBA_PI_PASSWORD", "PI_PASSWORD")
    ),
    "SERVER_PORT": str(get_node("server_port", defaults.get("server_port", 8787))),
    "PREFETCH_CHANNELS": ",".join(prefetch_channels),
}

for key, val in out.items():
    print(f"{key}={q(val)}")
PY
}

apply_one() {
  local name="$1"
  local eval_out
  eval_out="$(eval_pi "$name")"
  # shellcheck disable=SC2086
  eval "$eval_out"

  if [ -z "${PI_HOST:-}" ]; then
    echo "Skipping $PI_NAME (missing host)"
    return 0
  fi
  if [ -z "${PREFETCH_CHANNELS:-}" ]; then
    echo "Skipping $PI_NAME (no prefetch channels configured)"
    return 0
  fi

  local SSH_BASE=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  if [ -n "${PI_PASSWORD:-}" ] && command -v sshpass >/dev/null 2>&1; then
    SSH_BASE=(sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  fi

  local SSH_TARGET="${PI_USER}@${PI_HOST}"
  echo "Prefetch: $PI_NAME ($PI_HOST) channels=[$PREFETCH_CHANNELS] port=$SERVER_PORT wait=$WAIT timeout=${TIMEOUT_SEC}s"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  [dry-run] would ssh $SSH_TARGET and prefetch"
    return 0
  fi

  "${SSH_BASE[@]}" "$SSH_TARGET" bash -s -- "$SERVER_PORT" "$PREFETCH_CHANNELS" "$WAIT" "$TIMEOUT_SEC" <<'EOF'
set -euo pipefail
PORT="$1"
CHANNELS="$2"
WAIT="$3"
TIMEOUT_SEC="$4"

IFS=',' read -r -a ARR <<< "$CHANNELS"
for ch in "${ARR[@]}"; do
  ch="$(echo "$ch" | tr -d '\r\n' | xargs)"
  [ -z "$ch" ] && continue
  curl -sS -X POST "http://localhost:${PORT}/api/stash/prefetch" \
    -H "Content-Type: application/json" \
    -d "{\"channelId\":\"$ch\"}" >/dev/null || true
done

if [ "$WAIT" != "1" ]; then
  exit 0
fi

deadline=$(( $(date +%s) + TIMEOUT_SEC ))
for ch in "${ARR[@]}"; do
  ch="$(echo "$ch" | tr -d '\r\n' | xargs)"
  [ -z "$ch" ] && continue
  echo "  waiting for channelId=$ch..."
  while true; do
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      echo "  timeout waiting for $ch"
      break
    fi
    json="$(curl -sS "http://localhost:${PORT}/api/stash/status?channelId=${ch}" || true)"
    python3 - "$ch" <<'PY' "$json"
import sys, json
ch = sys.argv[1]
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    print("  status: bad_json")
    sys.exit(2)
cached = int(data.get("cached") or 0)
total = int(data.get("total") or 0)
print(f"  status: {cached}/{total} cached")
sys.exit(0 if total > 0 and cached >= total else 1)
PY
    rc=$?
    if [ "$rc" -eq 0 ]; then
      break
    fi
    sleep 2
  done
done
EOF
}

if [ "$APPLY_ALL" -eq 1 ]; then
  # Run in parallel locally; each worker SSHes to a Pi.
  list_pis | xargs -I{} -P "$JOBS" bash -lc "$(printf '%q ' "$0") --registry $(printf '%q' "$REGISTRY_PATH") --pi {} $( [ "$WAIT" -eq 1 ] && echo --wait ) --timeout-sec $(printf '%q' "$TIMEOUT_SEC") $( [ "$DRY_RUN" -eq 1 ] && echo --dry-run )"
else
  if [ -z "$PI_NAME" ]; then
    usage
  fi
  apply_one "$PI_NAME"
fi

