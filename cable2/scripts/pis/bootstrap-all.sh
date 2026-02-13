#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CABLE2_ROOT="$REPO_ROOT/cable2"
CLI_JS="$CABLE2_ROOT/packages/cli/dist/index.js"

REGISTRY_PATH="$CABLE2_ROOT/config/registry.prod.toml"
ENV_FILE="$CABLE2_ROOT/.env.pis.prod"
CONTROL_PLANE_URL=""
NO_REBOOT=0

usage() {
  cat <<EOF
Usage:
  $0 [--registry PATH] [--env-file PATH] [--control-plane-url URL] [--no-reboot]

Examples:
  $0
  $0 --control-plane-url http://10.10.13.9:8790
  $0 --registry ./cable2/config/registry.prod.toml --env-file ./cable2/.env.pis.prod
EOF
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
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_FILE="${1#*=}"
      shift
      ;;
    --control-plane-url)
      CONTROL_PLANE_URL="$2"
      shift 2
      ;;
    --control-plane-url=*)
      CONTROL_PLANE_URL="${1#*=}"
      shift
      ;;
    --no-reboot)
      NO_REBOOT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ ! -f "$REGISTRY_PATH" ]; then
  echo "Missing registry: $REGISTRY_PATH"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi
if [ ! -f "$CLI_JS" ]; then
  echo "Missing CLI build: $CLI_JS"
  echo "Run: pnpm -C cable2 build"
  exit 1
fi

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required"
  exit 1
fi

mapfile -t NODE_IDS < <("$PYTHON_BIN" - "$REGISTRY_PATH" <<'PY'
import sys
try:
    import tomllib as toml
except Exception:
    import tomli as toml

path = sys.argv[1]
with open(path, "rb") as f:
    data = toml.load(f)
pis = data.get("pis", {})
ids = sorted([k for k, v in pis.items() if isinstance(v, dict)])
for node_id in ids:
    print(node_id)
PY
)

if [ "${#NODE_IDS[@]}" -eq 0 ]; then
  echo "No nodes found in $REGISTRY_PATH"
  exit 1
fi

echo "Bootstrapping ${#NODE_IDS[@]} nodes from $REGISTRY_PATH"
echo "Env file: $ENV_FILE"
if [ -n "$CONTROL_PLANE_URL" ]; then
  echo "Control plane URL override: $CONTROL_PLANE_URL"
fi
echo ""

FAILED=()
SUCCEEDED=()

for node_id in "${NODE_IDS[@]}"; do
  echo "==> [$node_id]"
  ARGS=(
    "$CLI_JS" bootstrap "$node_id"
    --env-file "$ENV_FILE"
    --registry "$REGISTRY_PATH"
  )
  if [ -n "$CONTROL_PLANE_URL" ]; then
    ARGS+=(--control-plane-url "$CONTROL_PLANE_URL")
  fi
  if [ "$NO_REBOOT" -eq 1 ]; then
    ARGS+=(--no-reboot)
  fi

  if node "${ARGS[@]}"; then
    SUCCEEDED+=("$node_id")
  else
    FAILED+=("$node_id")
    echo "!! bootstrap failed: $node_id"
  fi
  echo ""
done

echo "Done."
echo "Succeeded (${#SUCCEEDED[@]}): ${SUCCEEDED[*]:-none}"
echo "Failed (${#FAILED[@]}): ${FAILED[*]:-none}"

if [ "${#FAILED[@]}" -gt 0 ]; then
  exit 1
fi
