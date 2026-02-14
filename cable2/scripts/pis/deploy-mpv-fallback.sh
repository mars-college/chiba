#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE_OVERRIDE=""

load_env() {
  if [ -n "$ENV_FILE_OVERRIDE" ]; then
    if [ ! -f "$ENV_FILE_OVERRIDE" ]; then
      echo "Missing env file: $ENV_FILE_OVERRIDE"
      exit 1
    fi
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE_OVERRIDE"
    set +a
    return
  fi

  local f
  for f in "$REPO_ROOT/.env.pis.local" "$REPO_ROOT/cable2/.env.pis.local"; do
    if [ -f "$f" ]; then
      set -a
      # shellcheck disable=SC1090
      source "$f"
      set +a
    fi
  done
}

REGISTRY_PATH="$REPO_ROOT/cable2/config/registry.prod.toml"
PROFILE_PATH="$REPO_ROOT/cable2/config/profiles/midterms-gallery.toml"
CONFIG_ROOT="$REPO_ROOT/cable2/config"
REMOTE_DIR="/home/pi/chiba"
RUN_USER="pi"
PATH_MAP="/Volumes/share=/mnt/share"
IMAGE_SECONDS="12"
PI_NAME=""
APPLY_ALL=0
DRY_RUN=0
NO_ENABLE=0
NO_START=0
KEEP_CABLE_DISPLAY=0

usage() {
  cat <<EOF
Usage:
  $0 --pi <node-id> [options]
  $0 --all [options]

Options:
  --registry PATH
  --profile PATH
  --config-root PATH
  --remote-dir PATH             Remote repo root (default: $REMOTE_DIR)
  --run-user USER               Service run user (default: $RUN_USER)
  --path-map FROM=TO            (default: $PATH_MAP)
  --image-seconds N             (default: $IMAGE_SECONDS)
  --env-file PATH               Load per-node secrets (passwords) from file
  --dry-run
  --keep-cable-display          Do not disable chiba-kiosk/chiba-cable-guide on target
  --no-enable
  --no-start
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
    --profile)
      PROFILE_PATH="$2"
      shift 2
      ;;
    --profile=*)
      PROFILE_PATH="${1#*=}"
      shift
      ;;
    --config-root)
      CONFIG_ROOT="$2"
      shift 2
      ;;
    --config-root=*)
      CONFIG_ROOT="${1#*=}"
      shift
      ;;
    --remote-dir)
      REMOTE_DIR="$2"
      shift 2
      ;;
    --remote-dir=*)
      REMOTE_DIR="${1#*=}"
      shift
      ;;
    --run-user)
      RUN_USER="$2"
      shift 2
      ;;
    --run-user=*)
      RUN_USER="${1#*=}"
      shift
      ;;
    --path-map)
      PATH_MAP="$2"
      shift 2
      ;;
    --path-map=*)
      PATH_MAP="${1#*=}"
      shift
      ;;
    --image-seconds)
      IMAGE_SECONDS="$2"
      shift 2
      ;;
    --image-seconds=*)
      IMAGE_SECONDS="${1#*=}"
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
    --env-file)
      ENV_FILE_OVERRIDE="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_FILE_OVERRIDE="${1#*=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --keep-cable-display)
      KEEP_CABLE_DISPLAY=1
      shift
      ;;
    --no-enable)
      NO_ENABLE=1
      shift
      ;;
    --no-start)
      NO_START=1
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
if [ ! -f "$PROFILE_PATH" ]; then
  echo "Missing profile: $PROFILE_PATH"
  exit 1
fi
if [ ! -d "$CONFIG_ROOT" ]; then
  echo "Missing config root: $CONFIG_ROOT"
  exit 1
fi

if [ "$APPLY_ALL" -ne 1 ] && [ -z "$PI_NAME" ]; then
  usage
fi

load_env

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required"
  exit 1
fi

suffix_for() {
  "$PYTHON_BIN" - "$1" <<'PY'
import sys
name = sys.argv[1]
out = []
last_us = False
for ch in name:
    is_ok = ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ("0" <= ch <= "9")
    if is_ok:
        out.append(ch.upper())
        last_us = False
    else:
        if not last_us:
            out.append("_")
            last_us = True
print("".join(out).strip("_"))
PY
}

list_pis() {
  "$PYTHON_BIN" - "$REGISTRY_PATH" <<'PY'
import sys
try:
    import tomllib as toml
except Exception:
    import tomli as toml

with open(sys.argv[1], "rb") as fh:
    data = toml.load(fh)
pis = data.get("pis", {}) or {}
for key in sorted(pis.keys()):
    print(key)
PY
}

resolve_profile_target() {
  local node_id="$1"
  "$PYTHON_BIN" - "$PROFILE_PATH" "$node_id" <<'PY'
import sys
try:
    import tomllib as toml
except Exception:
    import tomli as toml

profile_path = sys.argv[1]
node_id = sys.argv[2]

with open(profile_path, "rb") as fh:
    data = toml.load(fh)

defaults = ((data.get("defaults") or {}).get("cable") or {})
node = (((data.get("pis") or {}).get(node_id) or {}).get("cable") or {})

merged = dict(defaults) if isinstance(defaults, dict) else {}
if isinstance(node, dict):
    merged.update(node)

target_kind = merged.get("target_kind")
target_id = merged.get("target_id")
if isinstance(target_kind, str) and isinstance(target_id, str) and target_kind.strip() and target_id.strip():
    print(f"{target_kind.strip()}:{target_id.strip()}")
    raise SystemExit(0)

channel = merged.get("channel")
if isinstance(channel, str) and channel.strip():
    print(f"channel:{channel.strip()}")
    raise SystemExit(0)

print("")
PY
}

resolve_pi() {
  local node_id="$1"
  local suffix
  suffix="$(suffix_for "$node_id")"

  "$PYTHON_BIN" - "$REGISTRY_PATH" "$node_id" "$suffix" <<'PY'
import os
import shlex
import sys
try:
    import tomllib as toml
except Exception:
    import tomli as toml

registry_path = sys.argv[1]
node_id = sys.argv[2]
suffix = sys.argv[3]

with open(registry_path, "rb") as fh:
    data = toml.load(fh)

def q(v):
    return shlex.quote("" if v is None else str(v))

def first_env(*keys):
    for key in keys:
        val = os.environ.get(key)
        if val:
            return val
    return ""

defs = data.get("defaults", {}) or {}
pis = data.get("pis", {}) or {}
node = pis.get(node_id, {}) or {}

host = (node.get("ip") or "").strip() or (node.get("host") or "").strip()
user = (node.get("user") or defs.get("user") or "pi")
password = (
    (node.get("password") or "").strip()
    or (defs.get("password") or "").strip()
    or first_env(f"CHIBA_PI_PASSWORD_{suffix}", "CHIBA_PI_PASSWORD", "PI_PASSWORD")
)

print(f"PI_HOST={q(host)}")
print(f"PI_USER={q(user)}")
print(f"PI_PASSWORD={q(password)}")
PY
}

to_relpath() {
  local abs_path="$1"
  local abs_root
  abs_root="$(cd "$REPO_ROOT" && pwd)"

  if [[ "$abs_path" == "$abs_root"/* ]]; then
    echo "${abs_path#$abs_root/}"
    return 0
  fi

  echo ""
  return 1
}

REGISTRY_ABS="$(cd "$(dirname "$REGISTRY_PATH")" && pwd)/$(basename "$REGISTRY_PATH")"
PROFILE_ABS="$(cd "$(dirname "$PROFILE_PATH")" && pwd)/$(basename "$PROFILE_PATH")"
CONFIG_ABS="$(cd "$CONFIG_ROOT" && pwd)"

REGISTRY_REL="$(to_relpath "$REGISTRY_ABS" || true)"
PROFILE_REL="$(to_relpath "$PROFILE_ABS" || true)"
CONFIG_REL="$(to_relpath "$CONFIG_ABS" || true)"

if [ -z "$REGISTRY_REL" ] || [ -z "$PROFILE_REL" ] || [ -z "$CONFIG_REL" ]; then
  echo "registry/profile/config-root must be inside repo: $REPO_ROOT"
  exit 1
fi

apply_one() {
  local node_id="$1"
  local target_ref
  target_ref="$(resolve_profile_target "$node_id")"
  if [ -z "$target_ref" ]; then
    echo "Skipping $node_id (no target in profile: $PROFILE_PATH)"
    return
  fi

  local eval_out
  eval_out="$(resolve_pi "$node_id")"
  # shellcheck disable=SC2086
  eval "$eval_out"

  if [ -z "${PI_HOST:-}" ]; then
    echo "Skipping $node_id (missing host/ip)"
    return
  fi

  local ssh_opts=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o ConnectTimeout=10
    -o ConnectionAttempts=1
  )

  local ssh_cmd=(ssh "${ssh_opts[@]}")
  local rsync_ssh=(ssh "${ssh_opts[@]}")
  if [ -n "${PI_PASSWORD:-}" ] && command -v sshpass >/dev/null 2>&1; then
    ssh_cmd=(sshpass -p "$PI_PASSWORD" ssh "${ssh_opts[@]}")
    rsync_ssh=(sshpass -p "$PI_PASSWORD" ssh "${ssh_opts[@]}")
  fi

  local target="${PI_USER}@${PI_HOST}"
  echo
  echo "[$node_id] deploying to $target (target=$target_ref)"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  dry-run: would sync config + fallback scripts and install service"
    return
  fi

  "${ssh_cmd[@]}" "$target" "mkdir -p '$REMOTE_DIR'"

  (
    cd "$REPO_ROOT"
    rsync -az \
      -R \
      -e "${rsync_ssh[*]}" \
      ./cable2/config \
      ./cable2/scripts/pis/fallback-mpv-launcher.py \
      ./cable2/scripts/pis/mpv-infobox.lua \
      ./cable2/scripts/pis/install-mpv-fallback-service.sh \
      "$target:$REMOTE_DIR/"
  )

  local install_args=(
    "sudo" "bash" "$REMOTE_DIR/cable2/scripts/pis/install-mpv-fallback-service.sh"
    "--node-id" "$node_id"
    "--run-user" "$RUN_USER"
    "--registry" "$REMOTE_DIR/$REGISTRY_REL"
    "--profile" "$REMOTE_DIR/$PROFILE_REL"
    "--config-root" "$REMOTE_DIR/$CONFIG_REL"
    "--path-map" "$PATH_MAP"
    "--image-seconds" "$IMAGE_SECONDS"
  )

  if [ -n "${CHIBA_NAS_HOST:-}" ]; then
    install_args+=("--nas-host" "$CHIBA_NAS_HOST")
  fi
  if [ -n "${CHIBA_NAS_SHARE:-}" ]; then
    install_args+=("--nas-share" "$CHIBA_NAS_SHARE")
  fi
  if [ -n "${CHIBA_NAS_MOUNT:-}" ]; then
    install_args+=("--nas-mount" "$CHIBA_NAS_MOUNT")
  fi
  if [ -n "${CHIBA_NAS_USER:-}" ]; then
    install_args+=("--nas-user" "$CHIBA_NAS_USER")
  fi
  if [ -n "${CHIBA_NAS_PASSWORD:-}" ]; then
    install_args+=("--nas-password" "$CHIBA_NAS_PASSWORD")
  fi

  if [ "$NO_ENABLE" -eq 1 ]; then
    install_args+=("--no-enable")
  fi
  if [ "$NO_START" -eq 1 ]; then
    install_args+=("--no-start")
  fi
  if [ "$KEEP_CABLE_DISPLAY" -eq 1 ]; then
    install_args+=("--keep-cable-display")
  fi

  "${ssh_cmd[@]}" "$target" "$(printf '%q ' "${install_args[@]}")"
}

if [ "$APPLY_ALL" -eq 1 ]; then
  while IFS= read -r node_id; do
    apply_one "$node_id"
  done < <(list_pis)
else
  apply_one "$PI_NAME"
fi
