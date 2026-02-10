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

# Pi installs rsync the repo without .git/, so record a deploy stamp for /api/version.
LOCAL_GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || true)"
DEPLOYED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PI_NAME=""
HOST_OVERRIDE=""
REBOOT_AFTER=0
ENABLE_AUTO_REBOOT=0
RSYNC_PROGRESS=0
RSYNC_TIMEOUT_SEC=""

usage() {
  echo "Usage: $0 <pi-name> [--registry path] [--host host-or-ip] [--enable-auto-reboot] [--reboot] [--rsync-progress] [--rsync-timeout-sec N]"
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
    --host)
      HOST_OVERRIDE="$2"
      shift 2
      ;;
    --host=*)
      HOST_OVERRIDE="${1#*=}"
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
    "NODE_NAME": get_node("node_name", name),
    "ORIENTATION": orientation,
    "DISPLAY_ROTATE": rotation,
    "API_KEY": (
        (node.get("api_key") or "").strip()
        or (get_default("api_key", "") or "").strip()
        or env_first(f"CHIBA_API_KEY_{pi_suffix}", "CHIBA_API_KEY")
    ),
    "EDEN_KEY": (
        (node.get("eden_key") or "").strip()
        or (get_default("eden_key", "") or "").strip()
        or env_first("CHIBA_EDEN_KEY", "EDEN_KEY")
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
    "SERVER_PORT": str(get_node("server_port", get_default("server_port", 8787))),
    "NAS_HOST": get_nested_node("nas", "host", get_nested_default("nas", "host")),
    "NAS_SHARE": get_nested_node("nas", "share", get_nested_default("nas", "share", "share")),
    "NAS_MOUNT": get_nested_node("nas", "mount", get_nested_default("nas", "mount", "/Volumes/share")),
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

if [ -z "$PI_HOST" ] || [ -z "$CONTROLLER_URL" ]; then
  echo "Registry missing required fields for $PI_NAME"
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

RSYNC_ARGS=(-az --delete)
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

rsync "${RSYNC_ARGS[@]}" \
  --exclude-from="$SCRIPT_DIR/rsync.exclude" \
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

./scripts/setup-node.sh \
  --controller-url "$CONTROLLER_URL" \
  --node-name "$NODE_NAME" \
  --api-key "$API_KEY" \
  --eden-key "$EDEN_KEY" \
  --wifi-ssid "$WIFI_SSID" \
  --wifi-password "$WIFI_PASSWORD" \
  --install-dir "$REMOTE_DIR" \
  --skip-git

if [ "$ENABLE_AUTO_REBOOT" -eq 1 ]; then
  sudo touch /var/tmp/chiba-auto-reboot-enabled
  sudo systemctl restart chiba-network-watchdog 2>/dev/null || true
fi

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
Environment=CHIBA_CONFIG=$REMOTE_DIR/cable/config/chiba.toml
Environment=PORT=$SERVER_PORT
ExecStart=/usr/bin/env pnpm -C $REMOTE_DIR/cable/apps/server dev
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
ExecStart=/usr/bin/env pnpm -C $REMOTE_DIR/cable/apps/guide exec vite preview --host 0.0.0.0 --port $GUIDE_PORT --strictPort
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable --now chiba-cable-server chiba-cable-guide

# Ensure node server is running before kiosk URL update
sudo systemctl start chiba-node || true
echo "Waiting for node server on port 8080..."
for i in {1..20}; do
  if curl -s http://localhost:8080/health >/dev/null 2>&1; then
    echo "Node server ready."
    break
  fi
  sleep 1
done

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
fi

# Install Playwright browsers (needed for weatherstar)
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
  pnpm -C "$REMOTE_DIR/cable/apps/server" exec playwright install --with-deps || true
fi

# Set kiosk URL to cable guide (via API + file sync fallback).
# Important: the node API can require an API key; bootstrap must include it.
AUTH_HEADER=()
if [ -n "$API_KEY" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer $API_KEY")
fi
curl -sS -X POST http://localhost:8080/kiosk-url \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d "{\"url\":\"$KIOSK_URL\"}" >/dev/null || true
# Always keep the launcher file aligned with the intended URL (run-kiosk.sh reads this).
echo "$KIOSK_URL" > "$REMOTE_DIR/.kiosk-url" 2>/dev/null || true

# Best-effort: rotate display for portrait screens (persists on the Pi).
case "${DISPLAY_ROTATE:-}" in
  0|90|180|270)
    curl -sS -X POST http://localhost:8080/rotate \
      -H "Content-Type: application/json" \
      -d "{\"rotation\":${DISPLAY_ROTATE}}" >/dev/null 2>&1 || true
    ;;
  * )
    ;;
esac

if [ "$REBOOT_AFTER" -eq 1 ]; then
  echo "Rebooting $NODE_NAME..."
  sudo reboot
fi

echo "Bootstrap complete on $NODE_NAME"
EOF

printf "\nDone.\n"
