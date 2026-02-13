#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
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
  for f in "$REPO_ROOT/../.env.pis.local" "$REPO_ROOT/.env.pis.local"; do
    if [ -f "$f" ]; then
      set -a
      # shellcheck disable=SC1090
      source "$f"
      set +a
    fi
  done
}

REGISTRY_PATH="$REPO_ROOT/../scripts/pis/registry.toml"
if [ ! -f "$REGISTRY_PATH" ]; then
  REGISTRY_PATH="$REPO_ROOT/scripts/pis/registry.toml"
fi
if [ ! -f "$REGISTRY_PATH" ]; then
  REGISTRY_PATH="$SCRIPT_DIR/registry.toml"
fi

# Pi installs rsync the repo without .git/, so record a deploy stamp for /api/version.
LOCAL_GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || true)"
DEPLOYED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PI_NAME=""
HOST_OVERRIDE=""
CONTROL_PLANE_URL_OVERRIDE=""
# For fresh Pi provisioning, reboot by default so services + display session
# come up cleanly on the final installed config.
REBOOT_AFTER=1
ENABLE_AUTO_REBOOT=0
RSYNC_PROGRESS=0
RSYNC_TIMEOUT_SEC=""

usage() {
  echo "Usage: $0 <pi-name> [--env-file path] [--registry path] [--host host-or-ip] [--control-plane-url URL] [--enable-auto-reboot] [--no-reboot] [--rsync-progress] [--rsync-timeout-sec N]"
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
    --help|-h)
      usage
      ;;
    --env-file)
      ENV_FILE_OVERRIDE="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_FILE_OVERRIDE="${1#*=}"
      shift
      ;;
    --host)
      HOST_OVERRIDE="$2"
      shift 2
      ;;
    --host=*)
      HOST_OVERRIDE="${1#*=}"
      shift
      ;;
    --control-plane-url)
      CONTROL_PLANE_URL_OVERRIDE="$2"
      shift 2
      ;;
    --control-plane-url=*)
      CONTROL_PLANE_URL_OVERRIDE="${1#*=}"
      shift
      ;;
    --enable-auto-reboot)
      ENABLE_AUTO_REBOOT=1
      shift
      ;;
    --reboot)
      REBOOT_AFTER=1
      shift
      ;;
    --no-reboot)
      REBOOT_AFTER=0
      shift
      ;;
    --rsync-progress)
      # Shows overall progress during the initial repo sync.
      RSYNC_PROGRESS=1
      shift
      ;;
    --rsync-timeout-sec)
      # rsync I/O timeout (seconds). If nothing transfers for this long, rsync aborts.
      RSYNC_TIMEOUT_SEC="$2"
      shift 2
      ;;
    --rsync-timeout-sec=*)
      RSYNC_TIMEOUT_SEC="${1#*=}"
      shift
      ;;
    *)
      if [ -z "$PI_NAME" ]; then
        PI_NAME="$1"
        shift
      else
        echo "Unknown argument: $1"
        usage
      fi
      ;;
  esac
done

if [ -z "$PI_NAME" ]; then
  usage
fi

load_env

if [ ! -f "$REGISTRY_PATH" ]; then
  echo "Missing registry: $REGISTRY_PATH"
  exit 1
fi

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required to parse $REGISTRY_PATH"
  exit 1
fi

# shellcheck disable=SC2046
EVAL_OUT="$($PYTHON_BIN - "$REGISTRY_PATH" "$PI_NAME" <<'PY'
import sys
import shlex
import os
try:
    import tomllib as toml_parser
except Exception:
    try:
        import tomli as toml_parser
    except Exception:
        print("ERROR=missing_tomllib")
        sys.exit(0)

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

def get_default(key, default=""):
    return data.get("defaults", {}).get(key, default)

def get_nested_default(section, key, default=""):
    return data.get("defaults", {}).get(section, {}).get(key, default)

pis = data.get("pis", {})
if name not in pis:
    print("ERROR=missing_pi")
    print(f"MISSING_PI={q(name)}")
    sys.exit(0)

node = pis[name]
pi_suffix = suffix(name)

def get_node(key, default=""):
    return node.get(key, get_default(key, default))

def get_nested_node(section, key, default=""):
    return node.get(section, {}).get(key, get_nested_default(section, key, default))

orientation = (node.get("orientation") or "").strip().lower() if isinstance(node.get("orientation"), str) else ""

rotation = ""
raw_rotate = node.get("display_rotate", get_default("display_rotate", ""))
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
    rotation = "0"
    if orientation == "portrait":
        rotation = "90"

out = {
    "PI_NAME": name,
    # Prefer static IPs to avoid flaky mDNS + client-to-client Wi-Fi isolation.
    "PI_HOST": (get_node("ip") or "").strip() or get_node("host"),
    "PI_USER": get_node("user", get_default("user", "pi")),
    "PI_PASSWORD": (
        (node.get("password") or "").strip()
        or (get_default("password", "") or "").strip()
        or env_first(f"CHIBA_PI_PASSWORD_{pi_suffix}", "CHIBA_PI_PASSWORD", "PI_PASSWORD")
    ),
    "CONTROLLER_URL": get_node("controller_url"),
    "CONTROL_PLANE_URL": (
        (node.get("control_plane_url") or "").strip()
        or (get_default("control_plane_url", "") or "").strip()
        or env_first("CHIBA_CONTROL_PLANE_URL")
    ),
    "NODE_NAME": get_node("node_name", name),
    "ORIENTATION": orientation,
    "DISPLAY_ROTATE": rotation,
    "API_KEY": (
        (node.get("api_key") or "").strip()
        or (get_default("api_key", "") or "").strip()
        or env_first(
            f"CHIBA_NODE_API_KEY_{pi_suffix}",
            f"CHIBA_API_KEY_{pi_suffix}",
            "CHIBA_NODE_API_KEY",
            "CHIBA_API_KEY",
        )
    ),
    "EDEN_KEY": (
        (node.get("eden_key") or "").strip()
        or (get_default("eden_key", "") or "").strip()
        or env_first("CHIBA_EDEN_KEY", "CHIBA_EDEN_API_KEY", "EDEN_API_KEY", "EDEN_KEY")
    ),
    "WIFI_SSID": (
        (node.get("wifi_ssid") or "").strip()
        or (get_default("wifi_ssid", "") or "").strip()
        or env_first(f"CHIBA_WIFI_SSID_{pi_suffix}", "CHIBA_WIFI_SSID", "WIFI_SSID")
    ),
    "WIFI_PASSWORD": (
        (node.get("wifi_password") or "").strip()
        or (get_default("wifi_password", "") or "").strip()
        or env_first(f"CHIBA_WIFI_PASSWORD_{pi_suffix}", "CHIBA_WIFI_PASSWORD", "WIFI_PASSWORD")
    ),
    "GUIDE_PORT": str(get_node("guide_port", get_default("guide_port", 5173))),
    "NODE_PORT": str(get_node("node_port", get_default("node_port", 8080))),
    "SERVER_PORT": str(get_node("server_port", get_default("server_port", 8787))),
    "NAS_HOST": (
        get_nested_node("nas", "host", get_nested_default("nas", "host"))
        or env_first("CHIBA_NAS_HOST", "NAS_HOST")
    ),
    "NAS_SHARE": (
        get_nested_node("nas", "share", get_nested_default("nas", "share", "share"))
        or env_first("CHIBA_NAS_SHARE", "NAS_SHARE")
    ),
    "NAS_MOUNT": (
        get_nested_node("nas", "mount", get_nested_default("nas", "mount", "/Volumes/share"))
        or env_first("CHIBA_NAS_MOUNT", "NAS_MOUNT")
    ),
    "NAS_USER": (
        (get_nested_node("nas", "user", "") or "").strip()
        or (get_nested_default("nas", "user", "") or "").strip()
        or env_first("CHIBA_NAS_USER", "NAS_USER")
    ),
    "NAS_PASSWORD": (
        (get_nested_node("nas", "password", "") or "").strip()
        or (get_nested_default("nas", "password", "") or "").strip()
        or env_first("CHIBA_NAS_PASSWORD", "NAS_PASSWORD")
    ),
}

for key, val in out.items():
    print(f"{key}={q(val)}")
PY
)"

if echo "$EVAL_OUT" | grep -q "^ERROR=missing_tomllib"; then
  echo "Python tomllib is unavailable. Use Python 3.11+ or install tomli."
  exit 1
fi

if echo "$EVAL_OUT" | grep -q "^ERROR=missing_pi"; then
  echo "Unknown pi in registry: $PI_NAME"
  echo ""
  echo "Note: bootstrap.sh expects a *pi-name* key from the registry (e.g. upper-east-3), not a hostname like mars29.local."
  echo "Known pi names in $REGISTRY_PATH:"
  rg -n "^\\[pis\\." "$REGISTRY_PATH" | sed -E 's/^.*\\[pis\\.([^\\]]+)\\].*$/  - \\1/' || true
  exit 1
fi

# shellcheck disable=SC2086
eval "$EVAL_OUT"

if [ -n "$HOST_OVERRIDE" ]; then
  PI_HOST="$HOST_OVERRIDE"
fi
if [ -n "$CONTROL_PLANE_URL_OVERRIDE" ]; then
  CONTROL_PLANE_URL="$CONTROL_PLANE_URL_OVERRIDE"
fi

# Legacy setup script still expects a controller URL.
# In cable2 local mode, control-plane URL is the right default fallback.
if [ -z "$CONTROLLER_URL" ] && [ -n "$CONTROL_PLANE_URL" ]; then
  CONTROLLER_URL="$CONTROL_PLANE_URL"
fi

if [ -z "$PI_HOST" ] || [ -z "$CONTROLLER_URL" ]; then
  echo "Registry missing required fields for $PI_NAME"
  echo "Resolved values: PI_HOST='${PI_HOST:-}' CONTROLLER_URL='${CONTROLLER_URL:-}' CONTROL_PLANE_URL='${CONTROL_PLANE_URL:-}'"
  exit 1
fi

SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=10
  -o ConnectionAttempts=1
  -o ServerAliveInterval=5
  -o ServerAliveCountMax=1
)

SSH_BASE=(ssh "${SSH_OPTS[@]}")
RSYNC_RSH=(ssh "${SSH_OPTS[@]}")

if [ -n "$PI_PASSWORD" ] && command -v sshpass >/dev/null 2>&1; then
  SSH_BASE=(sshpass -p "$PI_PASSWORD" ssh "${SSH_OPTS[@]}")
  RSYNC_RSH=(sshpass -p "$PI_PASSWORD" ssh "${SSH_OPTS[@]}")
fi

SSH_TARGET="${PI_USER}@${PI_HOST}"
REMOTE_DIR="/home/${PI_USER}/chiba"
KIOSK_URL="http://localhost:${GUIDE_PORT}/?screenId=${NODE_NAME}"

printf "\nSyncing repo to %s...\n" "$SSH_TARGET"
"${SSH_BASE[@]}" "$SSH_TARGET" "mkdir -p $REMOTE_DIR"

# Cleanup stale legacy directories from older app layouts (best effort).
# This prevents noisy rsync delete failures and stale code shadowing.
"${SSH_BASE[@]}" "$SSH_TARGET" "bash -lc '
set -e
rm -rf \"$REMOTE_DIR/cable\" \
       \"$REMOTE_DIR/packages/controller\" \
       \"$REMOTE_DIR/packages/dashboard\" \
       \"$REMOTE_DIR/packages/node\" \
       \"$REMOTE_DIR/packages/player\" \
       \"$REMOTE_DIR/packages/shared\" 2>/dev/null || true
if command -v sudo >/dev/null 2>&1; then
  sudo rm -rf \"$REMOTE_DIR/cable\" \
             \"$REMOTE_DIR/packages/controller\" \
             \"$REMOTE_DIR/packages/dashboard\" \
             \"$REMOTE_DIR/packages/node\" \
             \"$REMOTE_DIR/packages/player\" \
             \"$REMOTE_DIR/packages/shared\" 2>/dev/null || true
fi
'"

RSYNC_ARGS=(-az --delete --force)
if [ "$RSYNC_PROGRESS" -eq 1 ]; then
  # macOS ships an ancient rsync (2.6.x) that doesn't support --info=progress2.
  # Use progress2 only on rsync 3+.
  RSYNC_V_RAW="$(rsync --version 2>/dev/null | head -n 1 || true)"
  RSYNC_V="$(printf "%s" "$RSYNC_V_RAW" | awk '{print $3}' | tr -d '[:space:]')"
  RSYNC_MAJOR="$(printf "%s" "$RSYNC_V" | cut -d. -f1 | tr -cd '0-9')"
  if [ -n "$RSYNC_MAJOR" ] && [ "$RSYNC_MAJOR" -ge 3 ]; then
    RSYNC_ARGS+=(--info=progress2)
  else
    RSYNC_ARGS+=(--progress)
  fi
fi
if [ -n "$RSYNC_TIMEOUT_SEC" ]; then
  RSYNC_ARGS+=(--timeout="$RSYNC_TIMEOUT_SEC")
fi

# Avoid hanging forever in initial connect / handshake.
RSYNC_ARGS+=(--contimeout=10)

# Keep bootstrap self-contained: do not rely on an external rsync.exclude file.
RSYNC_EXCLUDES=(
  --exclude=.git/
  --exclude=node_modules/
  --exclude=.pnpm-store/
  --exclude=.vite/
  --exclude=.DS_Store
  --exclude=.env
  --exclude=.env.*
  --exclude=/media/
  --exclude=/media-cache/
  --exclude=/data/
  --exclude=/cable2/config/assets/
  --exclude=cable2/config/assets/
  --exclude=/cable2/config/assets/**
  --exclude=cable2/config/assets/**
  --exclude=dist/
  --exclude=build/
  --exclude='**/node_modules/'
  --exclude='**/.pnpm-store/'
  --exclude='**/dist/'
  --exclude='**/build/'
  --exclude='**/.vite/'
  --exclude=logs/
  --exclude=*.log
)

rsync "${RSYNC_ARGS[@]}" \
  "${RSYNC_EXCLUDES[@]}" \
  -e "${RSYNC_RSH[*]}" \
  "$REPO_ROOT/" "$SSH_TARGET:$REMOTE_DIR/"

printf "\nConfiguring node + cable on %s...\n" "$SSH_TARGET"

"${SSH_BASE[@]}" "$SSH_TARGET" bash -s <<EOF
set -e

if [ -n "$PI_PASSWORD" ]; then
  echo "$PI_PASSWORD" | sudo -S -v >/dev/null
fi

cd "$REMOTE_DIR"

# Deploy metadata for ops/version checks (read by cable server at runtime).
cat > "$REMOTE_DIR/.chiba-deploy.json" <<JSON
{"app":"chiba","gitSha":"$LOCAL_GIT_SHA","deployedAt":"$DEPLOYED_AT_UTC","method":"bootstrap","pi":"$PI_NAME"}
JSON

cat > "$REMOTE_DIR/.env" <<ENV
CHIBA_NODE_NAME=$NODE_NAME
CHIBA_NODE_API_KEY=$API_KEY
CHIBA_API_KEY=$API_KEY
CHIBA_CONTROL_PLANE_URL=$CONTROL_PLANE_URL
CHIBA_CONTROLLER_URL=$CONTROLLER_URL
EDEN_API_KEY=$EDEN_KEY
ENV

echo "Configuring Wi-Fi credentials (if provided)..."
if [ -n "$WIFI_SSID" ] && [ -n "$WIFI_PASSWORD" ]; then
  if command -v nmcli >/dev/null 2>&1; then
    sudo nmcli radio wifi on 2>/dev/null || true
    if nmcli -t -f NAME connection show | grep -Fxq "$WIFI_SSID"; then
      sudo nmcli connection modify "$WIFI_SSID" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$WIFI_PASSWORD" 2>/dev/null || true
      sudo nmcli connection up "$WIFI_SSID" 2>/dev/null || true
    else
      sudo nmcli device wifi connect "$WIFI_SSID" password "$WIFI_PASSWORD" 2>/dev/null || true
    fi
  elif [ -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
    if ! sudo grep -q "ssid=\"$WIFI_SSID\"" /etc/wpa_supplicant/wpa_supplicant.conf; then
      sudo tee -a /etc/wpa_supplicant/wpa_supplicant.conf > /dev/null <<WPAEOF

network={
  ssid="$WIFI_SSID"
  psk="$WIFI_PASSWORD"
}
WPAEOF
    fi
    sudo wpa_cli -i wlan0 reconfigure 2>/dev/null || true
  fi
fi

echo "Ensuring base runtime (Node.js + pnpm + dependencies)..."
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates git python3 build-essential rsync jq

echo "Ensuring kiosk runtime dependencies..."
if apt-cache policy chromium 2>/dev/null | grep -q "Candidate:"; then
  sudo apt-get install -y chromium
elif apt-cache policy chromium-browser 2>/dev/null | grep -q "Candidate:"; then
  sudo apt-get install -y chromium-browser
fi
sudo apt-get install -y xinit x11-xserver-utils xserver-xorg xdotool unclutter >/dev/null 2>&1 || true
sudo apt-get install -y cage wlr-randr seatd >/dev/null 2>&1 || true
sudo systemctl enable --now seatd >/dev/null 2>&1 || true
sudo usermod -aG video,audio,input,render "$PI_USER" >/dev/null 2>&1 || true

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
fi
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

PNPM_MAJOR=0
if command -v pnpm >/dev/null 2>&1; then
  PNPM_MAJOR="$(pnpm -v 2>/dev/null | sed -E 's/^([0-9]+).*/\1/' || echo 0)"
fi
if [ "${PNPM_MAJOR:-0}" -lt 9 ]; then
  echo "Installing pnpm 9..."
  sudo npm install -g pnpm@9
fi

echo "Installing workspace dependencies..."
# Some Pi images export NODE_ENV=production globally, which causes pnpm to
# skip devDependencies and breaks TypeScript builds (tsc missing). Force dev
# deps for bootstrap builds.
if ! CI=1 NODE_ENV=development pnpm -C "$REMOTE_DIR" install --force --no-frozen-lockfile --prod=false; then
  echo "pnpm install failed once; retrying..."
  sleep 2
  CI=1 NODE_ENV=development pnpm -C "$REMOTE_DIR" install --force --no-frozen-lockfile --prod=false
fi

echo "Building runtime targets..."
# Build shared workspace packages first so downstream package type resolution works
# on clean machines (node-agent imports @chiba-cable2/contracts).
pnpm -C "$REMOTE_DIR/packages/contracts" build
pnpm -C "$REMOTE_DIR/packages/core" build
pnpm -C "$REMOTE_DIR/apps/server" build
pnpm -C "$REMOTE_DIR/apps/guide" build
pnpm -C "$REMOTE_DIR/apps/ops" build
pnpm -C "$REMOTE_DIR/packages/node-agent" build
echo "Build step complete."

if [ ! -f "$REMOTE_DIR/apps/server/dist/index.js" ]; then
  echo "server build artifact missing: $REMOTE_DIR/apps/server/dist/index.js"
  exit 1
fi
if [ ! -f "$REMOTE_DIR/packages/node-agent/dist/index.js" ]; then
  echo "node-agent build artifact missing: $REMOTE_DIR/packages/node-agent/dist/index.js"
  exit 1
fi
if [ ! -f "$REMOTE_DIR/apps/guide/dist/index.html" ]; then
  echo "guide build artifact missing: $REMOTE_DIR/apps/guide/dist/index.html"
  exit 1
fi

# Ensure we always have a Wi-Fi/network watchdog on nodes.
if [ ! -x "$REMOTE_DIR/scripts/network-watchdog.sh" ]; then
  mkdir -p "$REMOTE_DIR/scripts"
  cat > "$REMOTE_DIR/scripts/network-watchdog.sh" <<'WATCHDOG'
#!/bin/bash
set -euo pipefail

CHECK_INTERVAL="\${CHECK_INTERVAL:-30}"
FAIL_THRESHOLD="\${FAIL_THRESHOLD:-4}"
AUTO_REBOOT_FLAG="/var/tmp/chiba-auto-reboot-enabled"
AUTO_REBOOT_FAILURES="\${AUTO_REBOOT_FAILURES:-40}"
FAIL_FILE="/var/tmp/chiba-network-failures"

log() {
  echo "[network-watchdog-lite] \$(date '+%Y-%m-%d %H:%M:%S') \$1"
}

wifi_iface() {
  ls /sys/class/net/wlan* 2>/dev/null | head -n 1 | xargs -I{} basename "{}" 2>/dev/null || true
}

has_ip() {
  local ip
  ip="\$(hostname -I 2>/dev/null | awk '{print \$1}')"
  [ -n "\${ip:-}" ] && [[ ! "\$ip" =~ ^127\. ]]
}

can_reach_gateway() {
  local gw
  gw="\$(ip route | awk '/default/ {print \$3; exit}')"
  [ -n "\${gw:-}" ] && ping -c 1 -W 3 "\$gw" >/dev/null 2>&1
}

recover_once() {
  local iface
  iface="\$(wifi_iface)"
  if [ -z "\${iface:-}" ]; then
    log "no wifi interface found; skipping recovery"
    return
  fi

  log "network recovery attempt on \$iface"
  sudo wpa_cli -i "\$iface" reconfigure >/dev/null 2>&1 || true
  sudo ip link set "\$iface" down >/dev/null 2>&1 || true
  sleep 2
  sudo ip link set "\$iface" up >/dev/null 2>&1 || true
  sudo dhcpcd -n "\$iface" >/dev/null 2>&1 || true
  sudo systemctl restart dhcpcd >/dev/null 2>&1 || true
  sudo nmcli radio wifi off >/dev/null 2>&1 || true
  sleep 1
  sudo nmcli radio wifi on >/dev/null 2>&1 || true
}

inc_failures() {
  local n
  n=0
  if [ -f "\$FAIL_FILE" ]; then
    n="\$(cat "\$FAIL_FILE" 2>/dev/null || echo 0)"
  fi
  n=\$((n + 1))
  echo "\$n" | sudo tee "\$FAIL_FILE" >/dev/null
  echo "\$n"
}

clear_failures() {
  echo "0" | sudo tee "\$FAIL_FILE" >/dev/null
}

while true; do
  if has_ip && can_reach_gateway; then
    clear_failures
  else
    failures="\$(inc_failures)"
    log "network unhealthy (consecutive failures: \$failures)"
    if [ "\$failures" -ge "\$FAIL_THRESHOLD" ]; then
      recover_once
    fi
    if [ -f "\$AUTO_REBOOT_FLAG" ] && [ "\$failures" -ge "\$AUTO_REBOOT_FAILURES" ]; then
      log "auto-reboot threshold reached; rebooting"
      sudo reboot
    fi
  fi
  sleep "\$CHECK_INTERVAL"
done
WATCHDOG
  chmod +x "$REMOTE_DIR/scripts/network-watchdog.sh"
fi

if [ ! -f /etc/systemd/system/chiba-network-watchdog.service ]; then
  sudo tee /etc/systemd/system/chiba-network-watchdog.service > /dev/null <<SERVICE
[Unit]
Description=Chiba Network Watchdog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=$REMOTE_DIR/scripts/network-watchdog.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE
  sudo systemctl daemon-reload
fi

sudo systemctl enable --now chiba-network-watchdog >/dev/null 2>&1 || true

if [ "$ENABLE_AUTO_REBOOT" -eq 1 ]; then
  sudo touch /var/tmp/chiba-auto-reboot-enabled
  sudo systemctl restart chiba-network-watchdog 2>/dev/null || true
fi

# Force kiosk-style boot (no desktop shell).
sudo systemctl set-default multi-user.target >/dev/null 2>&1 || true
sudo systemctl disable lightdm gdm3 sddm 2>/dev/null || true
# tty1 is reserved for kiosk display; keep tty2 as emergency shell.
sudo systemctl disable getty@tty1.service >/dev/null 2>&1 || true
sudo systemctl stop getty@tty1.service >/dev/null 2>&1 || true
sudo systemctl enable getty@tty2.service >/dev/null 2>&1 || true

mkdir -p "$REMOTE_DIR/scripts"
cat > "$REMOTE_DIR/scripts/run-kiosk.sh" <<'KIOSK'
#!/bin/bash
set -euo pipefail

CHIBA_DIR="\${CHIBA_DIR:-\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)}"
KIOSK_URL_FILE="\${CHIBA_KIOSK_URL_FILE:-\$CHIBA_DIR/.kiosk-url}"
KIOSK_RESTART_SIGNAL="\${CHIBA_KIOSK_RESTART_SIGNAL:-/tmp/chiba-kiosk-restart}"
KIOSK_EXIT_SIGNAL="\${CHIBA_KIOSK_EXIT_SIGNAL:-/tmp/chiba-exit-kiosk}"
ROTATE_CONFIG_FILE="\${CHIBA_DISPLAY_ROTATE_FILE:-\$CHIBA_DIR/.display-rotate}"
GUIDE_PORT="\${CHIBA_GUIDE_PORT:-5173}"
NODE_NAME="\${CHIBA_NODE_NAME:-node}"
KIOSK_BACKEND="\${CHIBA_KIOSK_BACKEND:-x11}"
XDG_RUNTIME_DIR="/tmp/chiba-xdg-runtime"

CHROMIUM_FLAGS=(
  --kiosk
  --start-fullscreen
  --ash-hide-cursor
  --force-device-scale-factor=1
  --high-dpi-support=1
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --disable-restore-session-state
  --no-first-run
  --autoplay-policy=no-user-gesture-required
  --check-for-update-interval=31536000
  --disable-features=TranslateUI
  --disable-pinch
  --overscroll-history-navigation=0
  --disable-background-networking
  --disable-sync
  --password-store=basic
  --disable-dev-shm-usage
  --no-sandbox
)

mkdir -p "\$XDG_RUNTIME_DIR" >/dev/null 2>&1 || true
chmod 700 "\$XDG_RUNTIME_DIR" >/dev/null 2>&1 || true
export XDG_RUNTIME_DIR

rotation_to_transform() {
  case "\$1" in
    0) echo "normal" ;;
    90) echo "90" ;;
    180) echo "180" ;;
    270) echo "270" ;;
    *) echo "normal" ;;
  esac
}

find_chromium() {
  if [ -x "/usr/bin/chromium" ]; then
    echo "/usr/bin/chromium"
    return
  fi
  if [ -x "/usr/bin/chromium-browser" ]; then
    echo "/usr/bin/chromium-browser"
    return
  fi
  if command -v chromium >/dev/null 2>&1; then
    command -v chromium
    return
  fi
  if command -v chromium-browser >/dev/null 2>&1; then
    command -v chromium-browser
    return
  fi
  echo ""
}

read_kiosk_url() {
  if [ -n "\${CHIBA_KIOSK_URL:-}" ]; then
    echo "\$CHIBA_KIOSK_URL"
    return
  fi
  if [ -f "\$KIOSK_URL_FILE" ]; then
    local url
    url="\$(tr -d '\r\n' < "\$KIOSK_URL_FILE" 2>/dev/null || true)"
    if [ -n "\$url" ]; then
      echo "\$url"
      return
    fi
  fi
  echo "http://localhost:\${GUIDE_PORT}/?screenId=\${NODE_NAME}"
}

apply_rotation_wayland() {
  [ -f "\$ROTATE_CONFIG_FILE" ] || return 0
  command -v wlr-randr >/dev/null 2>&1 || return 0
  local rotation transform output
  rotation="\$(cat "\$ROTATE_CONFIG_FILE" 2>/dev/null || true)"
  [ -n "\$rotation" ] || return 0
  transform="\$(rotation_to_transform "\$rotation")"
  [ "\$transform" != "normal" ] || return 0
  sleep 2
  output="\$(wlr-randr 2>/dev/null | awk '/^[A-Za-z0-9-]+ / { print \$1; exit }')"
  if [ -n "\$output" ]; then
    wlr-randr --output "\$output" --transform "\$transform" >/dev/null 2>&1 || true
  fi
}

wait_for_local_services() {
  local try
  for try in {1..30}; do
    if curl -fsS "http://127.0.0.1:\${GUIDE_PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

kill_browser_stack() {
  pkill -f "chromium --kiosk" 2>/dev/null || true
  pkill -f "chromium-browser --kiosk" 2>/dev/null || true
  pkill -f "cage.*chromium" 2>/dev/null || true
  pkill -f "cage.*chromium-browser" 2>/dev/null || true
  pkill -f "cage" 2>/dev/null || true
  pkill -f "Xorg :0" 2>/dev/null || true
  pkill -f "unclutter.*-root" 2>/dev/null || true
  rm -f /tmp/chiba-unclutter.pid >/dev/null 2>&1 || true
}

start_cursor_tools_x11() {
  (
    local tries=0
    while [ "\$tries" -lt 80 ]; do
      if DISPLAY=:0 xset q >/dev/null 2>&1; then
        # Disable X11 DPMS/screensaver so kiosk displays never sleep.
        DISPLAY=:0 xset s off -dpms s noblank >/dev/null 2>&1 || true
        if command -v xrandr >/dev/null 2>&1; then
          local output
          output="\$(DISPLAY=:0 xrandr --query 2>/dev/null | awk '/ connected / { print \$1; exit }')"
          if [ -n "\$output" ]; then
            DISPLAY=:0 xrandr --output "\$output" --auto >/dev/null 2>&1 || true
          fi
        fi
        if command -v xdotool >/dev/null 2>&1; then
          DISPLAY=:0 xdotool mousemove 1 1 >/dev/null 2>&1 || true
        fi
        if command -v unclutter >/dev/null 2>&1; then
          DISPLAY=:0 unclutter -idle 0.25 -root >/dev/null 2>&1 &
          echo "\$!" > /tmp/chiba-unclutter.pid 2>/dev/null || true
        fi
        exit 0
      fi
      tries=\$((tries + 1))
      sleep 0.25
    done
  ) &
}

stop_cursor_tools_x11() {
  if [ -f /tmp/chiba-unclutter.pid ]; then
    kill "\$(cat /tmp/chiba-unclutter.pid 2>/dev/null || true)" >/dev/null 2>&1 || true
    rm -f /tmp/chiba-unclutter.pid >/dev/null 2>&1 || true
  fi
  pkill -f "unclutter.*-root" 2>/dev/null || true
}

launch_with_cage() {
  local kiosk_url chromium_bin
  kiosk_url="\$1"
  chromium_bin="\$2"

  command -v cage >/dev/null 2>&1 || return 1
  apply_rotation_wayland &
  cage -s -- "\$chromium_bin" "\${CHROMIUM_FLAGS[@]}" "\$kiosk_url"
  return \$?
}

launch_with_xinit() {
  local kiosk_url chromium_bin xsession
  kiosk_url="\$1"
  chromium_bin="\$2"

  command -v xinit >/dev/null 2>&1 || return 1

  xsession="\$(mktemp /tmp/chiba-xsession.XXXXXX)"
  cat > "\$xsession" <<'XSESSION'
#!/bin/bash
set -euo pipefail

chromium_bin="$1"
kiosk_url="$2"
shift 2
chromium_args=("$@")
window_size=""

if command -v xset >/dev/null 2>&1; then
  xset s off -dpms s noblank >/dev/null 2>&1 || true
fi

if command -v xrandr >/dev/null 2>&1; then
  while read -r output; do
    [ -n "$output" ] || continue
    xrandr --output "$output" --auto >/dev/null 2>&1 || true
  done < <(xrandr --query 2>/dev/null | awk '/ connected / { print $1 }')
fi

if [ -z "$window_size" ] && command -v xdpyinfo >/dev/null 2>&1; then
  mode="$(xdpyinfo 2>/dev/null | awk '/dimensions:/ { print $2; exit }')"
  if [[ "$mode" =~ ^([0-9]+)x([0-9]+)$ ]]; then
    window_size="${BASH_REMATCH[1]},${BASH_REMATCH[2]}"
  fi
fi

if command -v xdotool >/dev/null 2>&1; then
  xdotool mousemove 1 1 >/dev/null 2>&1 || true
fi
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.25 -root >/dev/null 2>&1 &
fi

echo "[kiosk] launch backend=x11 size=${window_size:-auto}" >&2
chromium_cmd=("$chromium_bin" "${chromium_args[@]}" --window-position=0,0)
if [ -n "$window_size" ]; then
  chromium_cmd+=(--window-size="$window_size")
fi
chromium_cmd+=("$kiosk_url")
"${chromium_cmd[@]}" &
chromium_pid="$!"

if command -v xdotool >/dev/null 2>&1 && [ -n "$window_size" ]; then
  for _i in {1..40}; do
    win_id="$(xdotool search --onlyvisible --pid "$chromium_pid" 2>/dev/null | head -n 1 || true)"
    if [ -n "$win_id" ]; then
      IFS=',' read -r ww hh <<< "$window_size"
      xdotool windowmove "$win_id" 0 0 >/dev/null 2>&1 || true
      xdotool windowsize "$win_id" "$ww" "$hh" >/dev/null 2>&1 || true
      break
    fi
    sleep 0.2
  done
fi

wait "$chromium_pid"
XSESSION

  chmod +x "\$xsession"
  xinit "\$xsession" "\$chromium_bin" "\$kiosk_url" "\${CHROMIUM_FLAGS[@]}" -- :0 vt1 -keeptty -nolisten tcp
  local rc="\$?"
  rm -f "\$xsession" >/dev/null 2>&1 || true
  return "\$rc"
}

launch_once() {
  local kiosk_url chromium_bin
  kiosk_url="\$(read_kiosk_url)"
  chromium_bin="\$(find_chromium)"
  if [ -z "\$chromium_bin" ]; then
    echo "[kiosk] chromium binary missing"
    sleep 3
    return 1
  fi

  wait_for_local_services || true

  case "\$KIOSK_BACKEND" in
    wayland)
      launch_with_cage "\$kiosk_url" "\$chromium_bin" && return 0
      launch_with_xinit "\$kiosk_url" "\$chromium_bin" && return 0
      ;;
    x11)
      launch_with_xinit "\$kiosk_url" "\$chromium_bin" && return 0
      launch_with_cage "\$kiosk_url" "\$chromium_bin" && return 0
      ;;
    *)
      launch_with_xinit "\$kiosk_url" "\$chromium_bin" && return 0
      launch_with_cage "\$kiosk_url" "\$chromium_bin" && return 0
      ;;
  esac

  echo "[kiosk] unable to start display backend (CHIBA_KIOSK_BACKEND=\$KIOSK_BACKEND)"
  sleep 3
  return 1
}

rm -f "\$KIOSK_EXIT_SIGNAL" "\$KIOSK_RESTART_SIGNAL" >/dev/null 2>&1 || true

while true; do
  if [ -f "\$KIOSK_EXIT_SIGNAL" ]; then
    rm -f "\$KIOSK_EXIT_SIGNAL" >/dev/null 2>&1 || true
    break
  fi
  launch_once || true
  if [ -f "\$KIOSK_RESTART_SIGNAL" ]; then
    rm -f "\$KIOSK_RESTART_SIGNAL" >/dev/null 2>&1 || true
  fi
  kill_browser_stack
  sleep 1
done
KIOSK
chmod +x "$REMOTE_DIR/scripts/run-kiosk.sh"

# Cable services
sudo tee /etc/systemd/system/chiba-cable-server.service > /dev/null <<SERVICE
[Unit]
Description=Chiba Cable Server
After=network.target

[Service]
Type=simple
User=$PI_USER
WorkingDirectory=$REMOTE_DIR
# Load node/cable shared env (API_KEY, controller URL, etc). This lets the cable ops
# backend authenticate to the local node API when applying kiosk URLs.
EnvironmentFile=$REMOTE_DIR/.env
Environment=CHIBA_CONFIG=$REMOTE_DIR/config/chiba.toml
Environment=PORT=$SERVER_PORT
ExecStart=/usr/bin/env node $REMOTE_DIR/apps/server/dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

sudo tee /etc/systemd/system/chiba-cable-guide.service > /dev/null <<SERVICE
[Unit]
Description=Chiba Cable Guide
After=network.target

[Service]
Type=simple
User=$PI_USER
WorkingDirectory=$REMOTE_DIR
Environment=PORT=$GUIDE_PORT
ExecStart=/usr/bin/env pnpm -C $REMOTE_DIR/apps/guide exec vite preview --host 0.0.0.0 --port $GUIDE_PORT --strictPort
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

sudo tee /etc/systemd/system/chiba-cable2-node-agent.service > /dev/null <<SERVICE
[Unit]
Description=Chiba Cable2 Node Agent
After=network.target

[Service]
Type=simple
User=$PI_USER
WorkingDirectory=$REMOTE_DIR
EnvironmentFile=$REMOTE_DIR/.env
Environment=PORT=$NODE_PORT
Environment=CHIBA_NODE_ID=$PI_NAME
Environment=CHIBA_NODE_NAME=$NODE_NAME
Environment=CHIBA_CONTROL_PLANE_URL=$CONTROL_PLANE_URL
Environment=CHIBA_SERVER_PORT=$SERVER_PORT
Environment=CHIBA_GUIDE_PORT=$GUIDE_PORT
Environment=CHIBA_KIOSK_URL_FILE=$REMOTE_DIR/.kiosk-url
Environment=CHIBA_DISPLAY_ROTATE_FILE=$REMOTE_DIR/.display-rotate
Environment=CHIBA_KIOSK_RESTART_SIGNAL=/tmp/chiba-kiosk-restart
ExecStart=/usr/bin/env node $REMOTE_DIR/packages/node-agent/dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

# Drop stale kiosk overrides from previous installs (they may point to
# ./scripts/run-kiosk.sh or old runtime dirs).
sudo rm -rf /etc/systemd/system/chiba-kiosk.service.d >/dev/null 2>&1 || true

sudo tee /etc/systemd/system/chiba-kiosk.service > /dev/null <<SERVICE
[Unit]
Description=Chiba Kiosk Display
After=network-online.target chiba-cable-server.service chiba-cable-guide.service
Wants=network-online.target chiba-cable-server.service chiba-cable-guide.service
Conflicts=getty@tty1.service

[Service]
Type=simple
User=$PI_USER
Group=$PI_USER
PAMName=login
WorkingDirectory=$REMOTE_DIR
EnvironmentFile=$REMOTE_DIR/.env
Environment=CHIBA_NODE_NAME=$NODE_NAME
Environment=CHIBA_GUIDE_PORT=$GUIDE_PORT
Environment=CHIBA_KIOSK_URL_FILE=$REMOTE_DIR/.kiosk-url
Environment=CHIBA_DISPLAY_ROTATE_FILE=$REMOTE_DIR/.display-rotate
Environment=CHIBA_KIOSK_RESTART_SIGNAL=/tmp/chiba-kiosk-restart
Environment=CHIBA_KIOSK_BACKEND=x11
Environment=XDG_RUNTIME_DIR=/tmp/chiba-xdg-runtime
ExecStartPre=/usr/bin/install -d -m 700 -o $PI_USER -g $PI_USER /tmp/chiba-xdg-runtime
ExecStart=/usr/bin/env bash $REMOTE_DIR/scripts/run-kiosk.sh
Restart=always
RestartSec=2
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

# Clean up legacy node services/processes that can still bind the node port.
for legacy_svc in chiba-node chiba-node-agent chiba-cable-node; do
  sudo systemctl stop "\$legacy_svc" >/dev/null 2>&1 || true
  sudo systemctl disable "\$legacy_svc" >/dev/null 2>&1 || true
  sudo systemctl reset-failed "\$legacy_svc" >/dev/null 2>&1 || true
done

# Best-effort kill of any stale listener on the node port (e.g. orphaned node process).
PORT_PIDS="\$(sudo ss -ltnp \"sport = :$NODE_PORT\" 2>/dev/null | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p' | sort -u | xargs)"
if [ -n "\$PORT_PIDS" ]; then
  echo "Port $NODE_PORT already in use by pid(s): \$PORT_PIDS; terminating stale listeners..."
  sudo kill -TERM \$PORT_PIDS >/dev/null 2>&1 || true
  sleep 1
  for pid in \$PORT_PIDS; do
    if sudo kill -0 "\$pid" >/dev/null 2>&1; then
      sudo kill -KILL "\$pid" >/dev/null 2>&1 || true
    fi
  done
fi

sudo systemctl daemon-reload
sudo systemctl stop chiba-kiosk >/dev/null 2>&1 || true
sudo systemctl reset-failed chiba-kiosk >/dev/null 2>&1 || true
sudo systemctl enable --now chiba-cable-server chiba-cable-guide chiba-cable2-node-agent chiba-kiosk

echo "Checking service activation..."
FAILED_SERVICES=()
for svc in chiba-cable-server chiba-cable-guide chiba-cable2-node-agent chiba-kiosk; do
  if ! sudo systemctl is-active --quiet "\$svc"; then
    FAILED_SERVICES+=("\$svc")
  fi
done

if [ "\${#FAILED_SERVICES[@]}" -gt 0 ]; then
  echo "service activation failed for: \${FAILED_SERVICES[*]}"
  for svc in "\${FAILED_SERVICES[@]}"; do
    echo ""
    echo "----- systemctl status: \$svc -----"
    sudo systemctl status --no-pager -l "\$svc" || true
    echo "----- journal: \$svc (last 120 lines) -----"
    sudo journalctl -u "\$svc" -n 120 --no-pager || true
  done
  exit 1
fi

# Ensure node server is running before kiosk URL update
echo "Waiting for node agent on port $NODE_PORT..."
for i in {1..20}; do
  if curl -s "http://localhost:$NODE_PORT/health" >/dev/null 2>&1; then
    echo "Node server ready."
    break
  fi
  sleep 1
done
if ! curl -s "http://localhost:$NODE_PORT/health" >/dev/null 2>&1; then
  echo "node agent health endpoint did not become ready on port $NODE_PORT"
  sudo systemctl status --no-pager -l chiba-cable2-node-agent || true
  sudo journalctl -u chiba-cable2-node-agent -n 80 --no-pager || true
  exit 1
fi

# NAS mount (optional)
if [ -n "$NAS_HOST" ] && [ -n "$NAS_USER" ] && [ -n "$NAS_PASSWORD" ]; then
  sudo apt-get update -y
  sudo apt-get install -y cifs-utils
  sudo mkdir -p "$NAS_MOUNT"
  sudo mkdir -p /etc/samba
  sudo tee /etc/samba/credentials-chiba-nas > /dev/null <<CREDS
username=$NAS_USER
password=$NAS_PASSWORD
CREDS
  sudo chmod 600 /etc/samba/credentials-chiba-nas
  if ! grep -q "credentials-chiba-nas" /etc/fstab; then
    echo "//$NAS_HOST/$NAS_SHARE $NAS_MOUNT cifs credentials=/etc/samba/credentials-chiba-nas,iocharset=utf8,uid=$PI_USER,gid=$PI_USER,file_mode=0775,dir_mode=0775,nofail,x-systemd.automount 0 0" | sudo tee -a /etc/fstab
  fi
  if ! mountpoint -q "$NAS_MOUNT"; then
    sudo mount -a
  else
    echo "NAS already mounted at $NAS_MOUNT"
  fi

  # Keep macOS-style source paths working on Linux nodes.
  if [ "$NAS_MOUNT" != "/Volumes/share" ]; then
    sudo mkdir -p /Volumes
    if [ ! -e /Volumes/share ] || [ -L /Volumes/share ]; then
      sudo ln -sfn "$NAS_MOUNT" /Volumes/share
    fi
  fi
fi

# Install Playwright browsers (needed for weatherstar)
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
  pnpm -C "$REMOTE_DIR/apps/server" exec playwright install --with-deps || true
fi

# Set kiosk URL to cable guide (via API + file sync fallback).
# Important: the node API can require an API key; bootstrap must include it.
if [ -n "$API_KEY" ]; then
  curl -sS -X POST "http://localhost:$NODE_PORT/kiosk-url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "{\"url\":\"$KIOSK_URL\"}" >/dev/null || true
else
  curl -sS -X POST "http://localhost:$NODE_PORT/kiosk-url" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$KIOSK_URL\"}" >/dev/null || true
fi
# Always keep the launcher file aligned with the intended URL (run-kiosk.sh reads this).
echo "$KIOSK_URL" > "$REMOTE_DIR/.kiosk-url" 2>/dev/null || true
# Keep server-side kiosk-state in sync with fresh bootstrap default (guide URL).
curl -sS -X POST "http://localhost:$SERVER_PORT/api/kiosk/clear" \
  -H "Content-Type: application/json" \
  -d "{\"screenId\":\"$NODE_NAME\"}" >/dev/null 2>&1 || true

# Best-effort: rotate display for portrait screens (persists on the Pi).
case "${DISPLAY_ROTATE:-}" in
  0|90|180|270)
    curl -sS -X POST "http://localhost:$NODE_PORT/rotate" \
      -H "Content-Type: application/json" \
      -d "{\"rotation\":${DISPLAY_ROTATE}}" >/dev/null 2>&1 || true
    ;;
  * )
    ;;
esac

if [ "$REBOOT_AFTER" -eq 1 ]; then
  echo "Rebooting $NODE_NAME..."
  sudo nohup bash -lc "sleep 1; systemctl reboot || reboot" >/dev/null 2>&1 &
fi

echo "Bootstrap complete on $NODE_NAME"
EOF

printf "\nDone.\n"
