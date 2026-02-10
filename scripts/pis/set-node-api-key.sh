#!/bin/bash
set -euo pipefail

# Set a shared Chiba Node API key (API_KEY) on one or more Pis.
#
# Why:
# - ops:apply-mode talks to each Pi's node API (port 8080) which is protected when API_KEY is set.
# - setup-node.sh auto-generates a different API_KEY per device unless provided.
# - For fleet operations it's often easier to standardize on one shared key.
#
# Usage:
#   # Generate a new key and apply to all Pis
#   PI_PASSWORD=interact ./scripts/pis/set-node-api-key.sh --registry ./scripts/pis/registry.toml --all --generate --jobs 6
#
#   # Set an explicit key on a single Pi
#   PI_PASSWORD=interact ./scripts/pis/set-node-api-key.sh --registry ./scripts/pis/registry.toml --pi upper-west-4 --api-key <hex>
#
# Notes:
# - Requires SSH access to the Pi user (default "pi").
# - Restarts chiba-node so the new API key takes effect immediately.

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
PI_NAME=""
APPLY_ALL=0
JOBS=1
DRY_RUN=0

API_KEY_VALUE="${CHIBA_API_KEY:-}"
GENERATE=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pis/set-node-api-key.sh --registry path --pi <pi-name> (--api-key KEY | --generate) [--dry-run]
  ./scripts/pis/set-node-api-key.sh --registry path --all (--api-key KEY | --generate) [--jobs N] [--dry-run]

Options:
  --registry PATH   Inventory registry TOML (default: scripts/pis/registry.toml)
  --pi NAME         Target a single Pi (registry id)
  --all             Target all Pis in registry
  --api-key KEY     API key to set (writes API_KEY=<KEY> into /home/pi/chiba/.env)
  --generate        Generate a random key (prints it once, then applies)
  --jobs N          Parallelism when using --all (default 1)
  --dry-run         Print what would happen (no SSH changes)

Env:
  PI_PASSWORD / CHIBA_PI_PASSWORD  SSH password (used via sshpass if installed)
  CHIBA_API_KEY                   Default --api-key value (optional)
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY_PATH="$2"; shift 2;;
    --registry=*) REGISTRY_PATH="${1#*=}"; shift;;
    --pi) PI_NAME="$2"; shift 2;;
    --pi=*) PI_NAME="${1#*=}"; shift;;
    --all) APPLY_ALL=1; shift;;
    --jobs) JOBS="$2"; shift 2;;
    --jobs=*) JOBS="${1#*=}"; shift;;
    --api-key) API_KEY_VALUE="$2"; shift 2;;
    --api-key=*) API_KEY_VALUE="${1#*=}"; shift;;
    --generate) GENERATE=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    --help|-h) usage;;
    *) echo "Unknown arg: $1"; usage;;
  esac
done

if [ ! -f "$REGISTRY_PATH" ]; then
  echo "Missing registry: $REGISTRY_PATH"
  exit 1
fi

if [ "$APPLY_ALL" -eq 0 ] && [ -z "$PI_NAME" ]; then
  usage
fi

if [ "$GENERATE" -eq 1 ]; then
  API_KEY_VALUE="$(openssl rand -hex 24)"
  echo "Generated key: $API_KEY_VALUE"
fi

if [ -z "${API_KEY_VALUE:-}" ]; then
  echo "Missing --api-key (or set CHIBA_API_KEY, or use --generate)"
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
  "$PYTHON_BIN" - "$REGISTRY_PATH" "$name" <<'PY'
import os, sys, shlex
try:
    import tomllib as toml_parser
except Exception:
    import tomli as toml_parser  # type: ignore

reg_path = sys.argv[1]
pi_name = sys.argv[2]
with open(reg_path, "rb") as f:
    data = toml_parser.load(f)

defaults = data.get("defaults", {}) or {}
pis = data.get("pis", {}) or {}
node = pis.get(pi_name, {}) or {}

def get(key, default=""):
    v = node.get(key)
    if v is None or v == "":
        v = defaults.get(key, default)
    return v if v is not None else default

user = str(get("user", "pi") or "pi").strip()
host = (str(node.get("ip") or "").strip() or str(node.get("host") or "").strip())
install_dir = str(get("install_dir", "/home/pi/chiba") or "/home/pi/chiba").strip()

def q(v: str) -> str:
    return shlex.quote(str(v))

print(f"PI_USER={q(user)}")
print(f"PI_HOST={q(host)}")
print(f"INSTALL_DIR={q(install_dir)}")
PY
}

ssh_base_for_node() {
  local pw="$1"
  local base=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  if [ -n "$pw" ] && command -v sshpass >/dev/null 2>&1; then
    base=(sshpass -p "$pw" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  fi
  printf "%q " "${base[@]}"
}

apply_one() {
  local name="$1"
  local eval_out
  eval_out="$(eval_pi "$name")"
  # shellcheck disable=SC2086
  eval "$eval_out"

  if [ -z "${PI_HOST:-}" ]; then
    echo "Skipping $name (missing host/ip)"
    return 0
  fi

  local pw="${PI_PASSWORD:-${CHIBA_PI_PASSWORD:-}}"
  local ssh_cmd
  ssh_cmd="$(ssh_base_for_node "${pw:-}")"

  echo ""
  echo "[$name] ${PI_USER}@${PI_HOST}"
  echo "  set API_KEY in: ${INSTALL_DIR}/.env"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  [dry-run] API_KEY=${API_KEY_VALUE}"
    echo "  [dry-run] sudo systemctl restart chiba-node"
    return 0
  fi

  # shellcheck disable=SC2086
  eval $ssh_cmd "${PI_USER}@${PI_HOST}" bash -s -- "$INSTALL_DIR" "$API_KEY_VALUE" <<'EOF'
set -euo pipefail
INSTALL_DIR="$1"
KEY="$2"
ENV_FILE="$INSTALL_DIR/.env"

mkdir -p "$INSTALL_DIR"
touch "$ENV_FILE"

if grep -q '^API_KEY=' "$ENV_FILE" 2>/dev/null; then
  # POSIX-safe replacement
  tmp="$(mktemp)"
  awk -v k="$KEY" 'BEGIN{done=0} { if ($0 ~ /^API_KEY=/) { print "API_KEY=" k; done=1 } else { print $0 } } END{ if (!done) print "API_KEY=" k }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
else
  printf "\nAPI_KEY=%s\n" "$KEY" >> "$ENV_FILE"
fi

sudo systemctl restart chiba-node || true
EOF
}

export -f apply_one eval_pi ssh_base_for_node
export REGISTRY_PATH PYTHON_BIN API_KEY_VALUE DRY_RUN

if [ "$APPLY_ALL" -eq 1 ]; then
  # Best-effort parallel: xargs -P is present on macOS.
  list_pis | xargs -n 1 -P "$JOBS" -I {} bash -lc 'apply_one "$@"' _ {}
else
  apply_one "$PI_NAME"
fi

