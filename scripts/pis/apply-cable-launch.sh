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

INVENTORY_PATH="$SCRIPT_DIR/registry.toml"
MODE_PATH=""
PI_NAME=""
APPLY_ALL=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  # Legacy: single combined registry (contains host + cable settings)
  ./scripts/pis/apply-cable-launch.sh --registry path --pi <pi-name> [--dry-run]
  ./scripts/pis/apply-cable-launch.sh --registry path --all [--dry-run]

  # Composable: base inventory + mode/profile overrides
  ./scripts/pis/apply-cable-launch.sh --inventory ./scripts/pis/registry.toml --mode ./scripts/pis/mode.toml --pi <pi-name> [--dry-run]
  ./scripts/pis/apply-cable-launch.sh --inventory ./scripts/pis/registry.toml --mode ./scripts/pis/mode.toml --all [--dry-run]

This reads a Pi registry TOML and sets the kiosk URL to launch Chiba Cable with
gallery/kiosk parameters (channel pinning, QR hide/lock, etc).
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --inventory)
      INVENTORY_PATH="$2"
      shift 2
      ;;
    --inventory=*)
      INVENTORY_PATH="${1#*=}"
      shift
      ;;
    --mode)
      MODE_PATH="$2"
      shift 2
      ;;
    --mode=*)
      MODE_PATH="${1#*=}"
      shift
      ;;
    --registry)
      # Back-compat: a single file with both inventory + cable fields.
      INVENTORY_PATH="$2"
      MODE_PATH=""
      shift 2
      ;;
    --registry=*)
      INVENTORY_PATH="${1#*=}"
      MODE_PATH=""
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

if [ ! -f "$INVENTORY_PATH" ]; then
  echo "Missing inventory: $INVENTORY_PATH"
  exit 1
fi
if [ -n "$MODE_PATH" ] && [ ! -f "$MODE_PATH" ]; then
  echo "Missing mode: $MODE_PATH"
  exit 1
fi

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required to parse registry TOML"
  exit 1
fi

list_pis() {
  "$PYTHON_BIN" - "$INVENTORY_PATH" <<'PY'
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
  "$PYTHON_BIN" - "$INVENTORY_PATH" "$MODE_PATH" "$name" <<'PY'
import sys
import shlex
import os
import datetime
try:
    import tomllib as toml_parser
except Exception:
    import tomli as toml_parser  # type: ignore

inventory_path = sys.argv[1]
mode_path = sys.argv[2] or ""
name = sys.argv[3]

with open(inventory_path, "rb") as f:
    inventory = toml_parser.load(f)

mode = {}
if mode_path.strip():
    with open(mode_path, "rb") as f:
        mode = toml_parser.load(f)

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

inv_defaults = inventory.get("defaults", {}) or {}
inv_pis = inventory.get("pis", {}) or {}
node = inv_pis.get(name) or {}
pi_suffix = suffix(name)

def get_node(key, default=""):
    return node.get(key, inv_defaults.get(key, default))

def get_bool(section, key, default=False):
    raw = (node.get(section, {}) or {}).get(key, (inv_defaults.get(section, {}) or {}).get(key, default))
    return bool(raw) if isinstance(raw, bool) else default

def get_str(section, key, default=""):
    raw = (node.get(section, {}) or {}).get(key, (inv_defaults.get(section, {}) or {}).get(key, default))
    return raw if isinstance(raw, str) else default

def get_num(section, key):
    raw = (node.get(section, {}) or {}).get(key, (inv_defaults.get(section, {}) or {}).get(key))
    if isinstance(raw, int) or isinstance(raw, float):
        return raw
    return None

def ensure_dict(v):
    return v if isinstance(v, dict) else {}

# Cable settings:
# - If MODE_PATH is provided, use mode/profile defaults + per-pi overrides.
# - Otherwise (legacy), read cable settings directly from the inventory/registry file.
if mode_path.strip():
    d = ensure_dict(ensure_dict(mode.get("defaults")).get("cable"))
    p = ensure_dict(ensure_dict(ensure_dict(mode.get("pis")).get(name)).get("cable"))
    cable_mode = dict(d)
    cable_mode.update(p)
else:
    d = ensure_dict(inv_defaults.get("cable"))
    p = ensure_dict(node.get("cable"))
    cable_mode = dict(d)
    cable_mode.update(p)

def cable_get(key: str, default=None):
    v = cable_mode.get(key, default)
    return v

# Ambient mode helper:
# If `ambient_channels` is provided and `channel` is unset/blank, pick a
# deterministic channel per Pi (seeded by date + pi id).
def normalize_str_list(v):
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        if isinstance(x, str):
            s = x.strip()
            if s:
                out.append(s)
    # stable uniq
    seen = set()
    uniq = []
    for s in out:
        if s in seen:
            continue
        seen.add(s)
        uniq.append(s)
    return uniq

def fnv1a32(s: str) -> int:
    h = 0x811c9dc5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xffffffff
    return h

ambient_seed = (os.environ.get("CHIBA_AMBIENT_SEED") or "").strip() or datetime.date.today().isoformat()
ambient_pool = normalize_str_list(cable_get("ambient_channels"))
channel_raw = cable_get("channel", "")
channel = channel_raw.strip() if isinstance(channel_raw, str) else ""
if (not channel) and ambient_pool:
    idx = fnv1a32(f"{ambient_seed}:{name}") % max(1, len(ambient_pool))
    cable_mode["channel"] = ambient_pool[idx]

orientation = (
    (node.get("orientation") if isinstance(node.get("orientation"), str) else "")
    or (node.get("cable", {}).get("orientation") if isinstance((node.get("cable", {}) or {}).get("orientation"), str) else "")
    or (cable_mode.get("orientation") if isinstance(cable_mode.get("orientation"), str) else "")
)
orientation = (orientation or "").strip().lower()

rotation = ""
raw_rotate = node.get("display_rotate", inv_defaults.get("display_rotate", ""))
try:
    if isinstance(raw_rotate, (int, float)):
        r = int(raw_rotate)
    else:
        r = int(str(raw_rotate).strip() or "0")
    if r in (0, 90, 180, 270):
        rotation = str(r)
except Exception:
    rotation = ""

if rotation == "":
    if orientation == "portrait":
        rotation = "90"
    elif orientation == "landscape" or orientation == "":
        rotation = "0"

out = {
    "PI_NAME": name,
    # Prefer static IPs to avoid flaky mDNS + client-to-client Wi-Fi isolation.
    "PI_HOST": (get_node("ip") or "").strip() or get_node("host"),
    "PI_USER": get_node("user", "pi"),
    "PI_PASSWORD": (
        (node.get("password") or "").strip()
        or (inv_defaults.get("password") or "").strip()
        or env_first(f"CHIBA_PI_PASSWORD_{pi_suffix}", "CHIBA_PI_PASSWORD", "PI_PASSWORD")
    ),
    "NODE_NAME": get_node("node_name", name),
    "GUIDE_PORT": str(get_node("guide_port", inv_defaults.get("guide_port", 5173))),
    "INSTALL_DIR": get_node("install_dir", inv_defaults.get("install_dir", "/home/pi/chiba")),
    "CABLE_MODE": (str(cable_get("mode", "")) if cable_get("mode", "") is not None else "").strip(),
    "CABLE_THEME": (str(cable_get("theme", "")) if cable_get("theme", "") is not None else "").strip(),
    "CABLE_CHANNEL": (str(cable_get("channel", "")) if cable_get("channel", "") is not None else "").strip(),
    "CABLE_QR": "0" if cable_get("qr", True) is False else "1",
    "CABLE_LOCK": "1" if cable_get("lock", False) is True else "0",
    "CABLE_PLAYLIST": "1" if cable_get("playlist", False) is True else "0",
    "CABLE_NOSPLASH": "1" if cable_get("nosplash", False) is True else "0",
    "CABLE_ORIENTATION": orientation,
    "DISPLAY_ROTATE": rotation,
}

scale = cable_get("scale")
text_scale = cable_get("text_scale")
hours = cable_get("hours")
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
  elif [ "$mode" = "gallery" ] && [ "$lock" = "0" ]; then
    url="${url}&lock=0"
  fi
  if [ "$qr" = "0" ]; then
    url="${url}&qr=0"
  elif [ "$qr" = "1" ]; then
    url="${url}&qr=1"
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
    "${CABLE_PLAYLIST:-0}" \
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
  "${SSH_BASE[@]}" "$SSH_TARGET" bash -s -- "$kiosk_url" "$INSTALL_DIR" "${DISPLAY_ROTATE:-}" <<'EOF'
set -euo pipefail
URL="$1"
INSTALL_DIR="$2"
ROT="$3"

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

# Best-effort: rotate the display for portrait screens (persists on the Pi).
# This uses the local node API; if it's not running or auth blocks it, we ignore.
case "${ROT:-}" in
  0|90|180|270)
    curl -sS -X POST http://localhost:8080/rotate \
      -H "Content-Type: application/json" \
      -d "{\"rotation\":${ROT}}" >/dev/null 2>&1 || true
    ;;
  "" )
    ;;
  * )
    ;;
esac

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
