#!/bin/bash
set -euo pipefail

# Fast, minimal updates for Chiba Cable on Raspberry Pi kiosks.
#
# Goals:
# - Avoid rsyncing the entire repo.
# - Avoid reinstalling deps.
# - Make "update config everywhere" and "push new guide build" very quick.
#
# Typical usage:
#   # Push channel + cable config updates (no restarts needed; guide polls /api/index)
#   ./scripts/pis/fast-cable-update.sh --registry ./scripts/pis/registry.toml --all --config
#
#   # Push a new guide build to all screens, then restart kiosk (reloads Chromium)
#   ./scripts/pis/fast-cable-update.sh --registry ./scripts/pis/registry.toml --all --guide --build-guide --kiosk-restart
#
#   # Push server code (tsx watch should reload automatically)
#   ./scripts/pis/fast-cable-update.sh --registry ./scripts/pis/registry.local.toml --pi upper-west-1 --server

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

# Pi installs rsync without .git/, so stamp deployments for /api/version.
LOCAL_GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || true)"
DEPLOYED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PI_NAME=""
APPLY_ALL=0
DRY_RUN=0
JOBS=1

DO_CONFIG=0
DO_GUIDE=0
DO_SERVER=0
BUILD_GUIDE=0

RSYNC_DELETE=1
KIOSK_RESTART=0
RESTART_GUIDE=0
RESTART_SERVER=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pis/fast-cable-update.sh --registry path --pi <pi-name> [options]
  ./scripts/pis/fast-cable-update.sh --registry path --all [options]

Targets:
  --config         Sync cable config: cable/config/chiba.toml + cable/config/channels/
  --guide          Sync built guide assets: cable/apps/guide/dist/
  --server         Sync cable server code: cable/apps/server/src/

Build:
  --build-guide    Run pnpm build for cable guide before syncing dist/

Refresh / restarts:
  --kiosk-restart  POST /kiosk-restart on the Pi (forces Chromium reload)
  --restart-guide  systemctl restart chiba-cable-guide
  --restart-server systemctl restart chiba-cable-server

Other:
  --jobs N         Parallelism when using --all (default 1)
  --dry-run        Print actions but do not rsync/ssh
  --no-delete      Do not pass --delete to rsync

Notes:
  - Config updates are usually "hot": the cable server polls config changes ~2s,
    and the guide polls /api/index every 5s. No restarts needed.
  - Guide JS/CSS updates require a browser reload to take effect reliably; use --kiosk-restart.
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
    --no-delete)
      RSYNC_DELETE=0
      shift
      ;;
    --config)
      DO_CONFIG=1
      shift
      ;;
    --guide)
      DO_GUIDE=1
      shift
      ;;
    --server)
      DO_SERVER=1
      shift
      ;;
    --build-guide)
      BUILD_GUIDE=1
      shift
      ;;
    --kiosk-restart)
      KIOSK_RESTART=1
      shift
      ;;
    --restart-guide)
      RESTART_GUIDE=1
      shift
      ;;
    --restart-server)
      RESTART_SERVER=1
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

if [ "$DO_CONFIG" -eq 0 ] && [ "$DO_GUIDE" -eq 0 ] && [ "$DO_SERVER" -eq 0 ]; then
  echo "Select at least one target: --config, --guide, or --server"
  exit 1
fi

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required to parse $REGISTRY_PATH"
  exit 1
fi

if [ "$BUILD_GUIDE" -eq 1 ]; then
  if [ "$DO_GUIDE" -eq 0 ]; then
    echo "--build-guide requires --guide"
    exit 1
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] would build: pnpm -C cable/apps/guide build"
  else
    (cd "$REPO_ROOT" && pnpm -C cable/apps/guide build)
  fi
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

out = {
    "PI_NAME": name,
    # Prefer static IPs to avoid flaky mDNS + client-to-client Wi-Fi isolation.
    "PI_HOST": (get_node("ip") or "").strip() or get_node("host"),
    "PI_USER": get_node("user", "pi"),
    "PI_PASSWORD": (
        (node.get("password") or "").strip()
        or (defaults.get("password") or "").strip()
        or env_first(f"CHIBA_PI_PASSWORD_{pi_suffix}", "CHIBA_PI_PASSWORD", "PI_PASSWORD")
    ),
    "INSTALL_DIR": get_node("install_dir", defaults.get("install_dir", "/home/pi/chiba")),
}

for key, val in out.items():
    print(f"{key}={q(val)}")
PY
}

ssh_base_for_node() {
  local password="$1"
  local -a base=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  if [ -n "$password" ] && command -v sshpass >/dev/null 2>&1; then
    base=(sshpass -p "$password" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  fi
  echo "${base[@]}"
}

rsync_ssh_for_node() {
  local password="$1"
  local rsh=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  if [ -n "$password" ] && command -v sshpass >/dev/null 2>&1; then
    rsh=(sshpass -p "$password" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  fi
  printf "%s" "${rsh[*]}"
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

  local SSH_TARGET="${PI_USER}@${PI_HOST}"
  local rsync_delete_arg=""
  if [ "$RSYNC_DELETE" -eq 1 ]; then
    rsync_delete_arg="--delete"
  fi
  local rsync_rsh
  rsync_rsh="$(rsync_ssh_for_node "${PI_PASSWORD:-}")"

  echo ""
  echo "[$PI_NAME] $SSH_TARGET"

  if [ "$DO_CONFIG" -eq 1 ]; then
    echo "  sync: cable/config/"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "    [dry-run] rsync $REPO_ROOT/cable/config/ -> $INSTALL_DIR/cable/config/"
    else
      rsync -az $rsync_delete_arg \
        -e "$rsync_rsh" \
        "$REPO_ROOT/cable/config/" "$SSH_TARGET:$INSTALL_DIR/cable/config/"
    fi
  fi

  if [ "$DO_SERVER" -eq 1 ]; then
    echo "  sync: cable/apps/server/src/"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "    [dry-run] rsync $REPO_ROOT/cable/apps/server/src/ -> $INSTALL_DIR/cable/apps/server/src/"
    else
      rsync -az $rsync_delete_arg \
        -e "$rsync_rsh" \
        "$REPO_ROOT/cable/apps/server/src/" "$SSH_TARGET:$INSTALL_DIR/cable/apps/server/src/"
    fi
  fi

  if [ "$DO_GUIDE" -eq 1 ]; then
    echo "  sync: cable/apps/guide/dist/"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "    [dry-run] rsync $REPO_ROOT/cable/apps/guide/dist/ -> $INSTALL_DIR/cable/apps/guide/dist/"
    else
      if [ ! -d "$REPO_ROOT/cable/apps/guide/dist" ]; then
        echo "ERROR: missing local cable/apps/guide/dist (run with --build-guide)"
        return 1
      fi
      rsync -az $rsync_delete_arg \
        -e "$rsync_rsh" \
        "$REPO_ROOT/cable/apps/guide/dist/" "$SSH_TARGET:$INSTALL_DIR/cable/apps/guide/dist/"
    fi
  fi

  # Stamp deploy metadata so /api/version returns a meaningful git sha even without .git/.
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  stamp: $INSTALL_DIR/.chiba-deploy.json ($LOCAL_GIT_SHA @ $DEPLOYED_AT_UTC)"
  else
    local ssh_cmd
    ssh_cmd="$(ssh_base_for_node "${PI_PASSWORD:-}")"
    # shellcheck disable=SC2086
    eval $ssh_cmd "$SSH_TARGET" bash -s -- "$INSTALL_DIR" "$LOCAL_GIT_SHA" "$DEPLOYED_AT_UTC" "$DO_CONFIG" "$DO_SERVER" "$DO_GUIDE" <<'EOF'
set -euo pipefail
INSTALL_DIR="$1"
SHA="$2"
AT="$3"
DO_CONFIG="$4"
DO_SERVER="$5"
DO_GUIDE="$6"

targets=""
sep=""
if [ "$DO_CONFIG" -eq 1 ]; then
  targets="${targets}${sep}\"config\""
  sep=","
fi
if [ "$DO_SERVER" -eq 1 ]; then
  targets="${targets}${sep}\"server\""
  sep=","
fi
if [ "$DO_GUIDE" -eq 1 ]; then
  targets="${targets}${sep}\"guide\""
  sep=","
fi

mkdir -p "$INSTALL_DIR"
printf "%s\n" "{\"app\":\"chiba\",\"gitSha\":\"$SHA\",\"deployedAt\":\"$AT\",\"method\":\"fast-cable-update\",\"targets\":[${targets}]}" > "$INSTALL_DIR/.chiba-deploy.json"
EOF
  fi

  if [ "$RESTART_SERVER" -eq 1 ] || [ "$RESTART_GUIDE" -eq 1 ] || [ "$KIOSK_RESTART" -eq 1 ]; then
    local ssh_cmd
    ssh_cmd="$(ssh_base_for_node "${PI_PASSWORD:-}")"
    if [ "$DRY_RUN" -eq 1 ]; then
      [ "$RESTART_SERVER" -eq 1 ] && echo "  [dry-run] systemctl restart chiba-cable-server"
      [ "$RESTART_GUIDE" -eq 1 ] && echo "  [dry-run] systemctl restart chiba-cable-guide"
      [ "$KIOSK_RESTART" -eq 1 ] && echo "  [dry-run] POST http://localhost:8080/kiosk-restart"
    else
      # shellcheck disable=SC2086
      eval $ssh_cmd "$SSH_TARGET" bash -s -- "$RESTART_SERVER" "$RESTART_GUIDE" "$KIOSK_RESTART" <<'EOF'
set -euo pipefail
RESTART_SERVER="$1"
RESTART_GUIDE="$2"
KIOSK_RESTART="$3"

if [ "$RESTART_SERVER" -eq 1 ]; then
  sudo systemctl restart chiba-cable-server || true
fi
if [ "$RESTART_GUIDE" -eq 1 ]; then
  sudo systemctl restart chiba-cable-guide || true
fi
if [ "$KIOSK_RESTART" -eq 1 ]; then
  curl -sS -X POST http://localhost:8080/kiosk-restart >/dev/null 2>&1 || true
fi
EOF
    fi
  fi
}

export -f list_pis eval_pi apply_one ssh_base_for_node rsync_ssh_for_node
export REGISTRY_PATH PYTHON_BIN REPO_ROOT DO_CONFIG DO_GUIDE DO_SERVER BUILD_GUIDE DRY_RUN JOBS RSYNC_DELETE KIOSK_RESTART RESTART_GUIDE RESTART_SERVER

if [ "$APPLY_ALL" -eq 1 ]; then
  if [ "$JOBS" -gt 1 ]; then
    # Parallel mode: re-invoke this script per pi for portability (macOS bash is 3.2).
    list_pis | xargs -P "$JOBS" -n 1 -I{} "$0" \
      --registry "$REGISTRY_PATH" \
      --pi {} \
      $( [ "$DRY_RUN" -eq 1 ] && echo --dry-run ) \
      $( [ "$RSYNC_DELETE" -eq 0 ] && echo --no-delete ) \
      $( [ "$DO_CONFIG" -eq 1 ] && echo --config ) \
      $( [ "$DO_SERVER" -eq 1 ] && echo --server ) \
      $( [ "$DO_GUIDE" -eq 1 ] && echo --guide ) \
      $( [ "$KIOSK_RESTART" -eq 1 ] && echo --kiosk-restart ) \
      $( [ "$RESTART_GUIDE" -eq 1 ] && echo --restart-guide ) \
      $( [ "$RESTART_SERVER" -eq 1 ] && echo --restart-server )
    exit 0
  fi

  while IFS= read -r name; do
    apply_one "$name"
  done < <(list_pis)
else
  if [ -z "$PI_NAME" ]; then
    usage
  fi
  apply_one "$PI_NAME"
fi
