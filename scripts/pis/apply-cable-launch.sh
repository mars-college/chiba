#!/bin/bash
set -euo pipefail

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
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pis/apply-cable-launch.sh --registry path --pi <pi-name> [--dry-run]
  ./scripts/pis/apply-cable-launch.sh --registry path --all [--dry-run]

This reads a Pi registry TOML and sets the kiosk URL to launch Chiba Cable with
gallery/kiosk parameters (channel pinning, QR hide/lock, etc).
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
pis = data.get("pis", {})
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

def get_bool(section, key, default=False):
    raw = (node.get(section, {}) or {}).get(key, (defaults.get(section, {}) or {}).get(key, default))
    return bool(raw) if isinstance(raw, bool) else default

def get_str(section, key, default=""):
    raw = (node.get(section, {}) or {}).get(key, (defaults.get(section, {}) or {}).get(key, default))
    return raw if isinstance(raw, str) else default

def get_num(section, key):
    raw = (node.get(section, {}) or {}).get(key, (defaults.get(section, {}) or {}).get(key))
    if isinstance(raw, int) or isinstance(raw, float):
        return raw
    return None

out = {
    "PI_NAME": name,
    "PI_HOST": get_node("host"),
    "PI_USER": get_node("user", "pi"),
    "PI_PASSWORD": (
        (node.get("password") or "").strip()
        or (defaults.get("password") or "").strip()
        or env_first(f"CHIBA_PI_PASSWORD_{pi_suffix}", "CHIBA_PI_PASSWORD", "PI_PASSWORD")
    ),
    "NODE_NAME": get_node("node_name", name),
    "GUIDE_PORT": str(get_node("guide_port", defaults.get("guide_port", 5173))),
    "INSTALL_DIR": get_node("install_dir", defaults.get("install_dir", "/home/pi/chiba")),
    "CABLE_MODE": get_str("cable", "mode", ""),
    "CABLE_THEME": get_str("cable", "theme", ""),
    "CABLE_CHANNEL": get_str("cable", "channel", ""),
    "CABLE_QR": "1" if get_bool("cable", "qr", True) else "0",
    "CABLE_LOCK": "1" if get_bool("cable", "lock", True) else "0",
    "CABLE_PLAYLIST": "1" if get_bool("cable", "playlist", False) else "0",
    "CABLE_NOSPLASH": "1" if get_bool("cable", "nosplash", False) else "0",
}

scale = get_num("cable", "scale")
text_scale = get_num("cable", "text_scale")
hours = get_num("cable", "hours")
if scale is not None:
    out["CABLE_SCALE"] = str(scale)
if text_scale is not None:
    out["CABLE_TEXT_SCALE"] = str(text_scale)
if hours is not None:
    out["CABLE_HOURS"] = str(hours)

for key, val in out.items():
    print(f"{key}={q(val)}")
PY
}

build_kiosk_url() {
  local guide_port="$1"
  local node_name="$2"
  local mode="$3"
  local theme="$4"
  local channel="$5"
  local qr="$6"
  local lock="$7"
  local playlist="$8"
  local nosplash="$9"
  local scale="${10:-}"
  local text_scale="${11:-}"
  local hours="${12:-}"

  local url="http://localhost:${guide_port}/?screenId=${node_name}"
  if [ -n "$theme" ]; then
    url="${url}&theme=${theme}"
  fi
  if [ "$nosplash" = "1" ]; then
    url="${url}&nosplash=1"
  fi
  if [ "$mode" = "gallery" ]; then
    url="${url}&gallery=1"
  fi
  if [ "$playlist" = "1" ]; then
    url="${url}&playlist=1"
  fi
  if [ "$lock" = "1" ]; then
    url="${url}&lock=1"
  fi
  if [ "$qr" = "0" ]; then
    url="${url}&qr=0"
  fi
  if [ -n "$channel" ]; then
    url="${url}&channel=${channel}"
  fi
  if [ -n "$scale" ]; then
    url="${url}&scale=${scale}"
  fi
  if [ -n "$text_scale" ]; then
    url="${url}&textScale=${text_scale}"
  fi
  if [ -n "$hours" ]; then
    url="${url}&hours=${hours}"
  fi
  echo "$url"
}

apply_one() {
  local name="$1"
  local eval_out
  eval_out="$(eval_pi "$name")"
  # shellcheck disable=SC2086
  eval "$eval_out"

  if [ -z "${PI_HOST:-}" ]; then
    echo "Skipping $PI_NAME (missing host)"
    return
  fi

  local kiosk_url
  kiosk_url="$(build_kiosk_url \
    "$GUIDE_PORT" \
    "$NODE_NAME" \
    "${CABLE_MODE:-}" \
    "${CABLE_THEME:-}" \
    "${CABLE_CHANNEL:-}" \
    "${CABLE_QR:-1}" \
    "${CABLE_LOCK:-0}" \
    "${CABLE_NOSPLASH:-0}" \
    "${CABLE_SCALE:-}" \
    "${CABLE_TEXT_SCALE:-}" \
    "${CABLE_HOURS:-}")"

  echo ""
  echo "[$PI_NAME] $PI_USER@$PI_HOST"
  echo "  kiosk: $kiosk_url"

  if [ "$DRY_RUN" -eq 1 ]; then
    return
  fi

  local SSH_BASE=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  if [ -n "${PI_PASSWORD:-}" ] && command -v sshpass >/dev/null 2>&1; then
    SSH_BASE=(sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  fi

  local SSH_TARGET="${PI_USER}@${PI_HOST}"
  "${SSH_BASE[@]}" "$SSH_TARGET" bash -s -- "$kiosk_url" "$INSTALL_DIR" <<'EOF'
set -euo pipefail
URL="$1"
INSTALL_DIR="$2"

API_SET=0
if curl -sS -X POST http://localhost:8080/kiosk-url \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$URL\"}" >/dev/null 2>&1; then
  API_SET=1
fi

if [ "$API_SET" -eq 0 ]; then
  echo "$URL" > "$INSTALL_DIR/.kiosk-url"
else
  # Keep file in sync too, so run-kiosk can recover if node API is down.
  echo "$URL" > "$INSTALL_DIR/.kiosk-url" || true
fi

touch /tmp/chiba-kiosk-restart
EOF
}

if [ "$APPLY_ALL" -eq 1 ]; then
  while IFS= read -r name; do
    apply_one "$name"
  done < <(list_pis)
else
  if [ -z "$PI_NAME" ]; then
    usage
  fi
  apply_one "$PI_NAME"
fi
