#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REGISTRY_PATH="$SCRIPT_DIR/registry.local.toml"
PI_NAME=""

usage() {
  echo "Usage: $0 <pi-name> [--registry path]"
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

def get_node(key, default=""):
    return node.get(key, get_default(key, default))

def get_nested_node(section, key, default=""):
    return node.get(section, {}).get(key, get_nested_default(section, key, default))

out = {
    "PI_NAME": name,
    "PI_HOST": get_node("host"),
    "PI_USER": get_node("user", get_default("user", "pi")),
    "PI_PASSWORD": node.get("password", ""),
    "CONTROLLER_URL": get_node("controller_url"),
    "NODE_NAME": get_node("node_name", name),
    "API_KEY": node.get("api_key", ""),
    "EDEN_KEY": node.get("eden_key", ""),
    "WIFI_SSID": node.get("wifi_ssid", ""),
    "WIFI_PASSWORD": node.get("wifi_password", ""),
    "GUIDE_PORT": str(get_node("guide_port", get_default("guide_port", 5173))),
    "SERVER_PORT": str(get_node("server_port", get_default("server_port", 8787))),
    "NAS_HOST": get_nested_node("nas", "host", get_nested_default("nas", "host")),
    "NAS_SHARE": get_nested_node("nas", "share", get_nested_default("nas", "share", "share")),
    "NAS_MOUNT": get_nested_node("nas", "mount", get_nested_default("nas", "mount", "/Volumes/share")),
    "NAS_USER": get_nested_node("nas", "user", get_nested_default("nas", "user")),
    "NAS_PASSWORD": get_nested_node("nas", "password", get_nested_default("nas", "password")),
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
  exit 1
fi

# shellcheck disable=SC2086
eval "$EVAL_OUT"

if [ -z "$PI_HOST" ] || [ -z "$CONTROLLER_URL" ]; then
  echo "Registry missing required fields for $PI_NAME"
  exit 1
fi

SSH_BASE=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
RSYNC_RSH=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

if [ -n "$PI_PASSWORD" ] && command -v sshpass >/dev/null 2>&1; then
  SSH_BASE=(sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
  RSYNC_RSH=(sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
fi

SSH_TARGET="${PI_USER}@${PI_HOST}"
REMOTE_DIR="/home/${PI_USER}/chiba"
KIOSK_URL="http://localhost:${GUIDE_PORT}/"

printf "\nSyncing repo to %s...\n" "$SSH_TARGET"
"${SSH_BASE[@]}" "$SSH_TARGET" "mkdir -p $REMOTE_DIR"

rsync -az --delete \
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

./scripts/setup-node.sh \
  --controller-url "$CONTROLLER_URL" \
  --node-name "$NODE_NAME" \
  --api-key "$API_KEY" \
  --eden-key "$EDEN_KEY" \
  --wifi-ssid "$WIFI_SSID" \
  --wifi-password "$WIFI_PASSWORD" \
  --install-dir "$REMOTE_DIR" \
  --skip-git

# Cable services
sudo tee /etc/systemd/system/chiba-cable-server.service > /dev/null <<SERVICE
[Unit]
Description=Chiba Cable Server
After=network.target

[Service]
Type=simple
User=$PI_USER
WorkingDirectory=$REMOTE_DIR
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
ExecStart=/usr/bin/env pnpm -C $REMOTE_DIR/cable/apps/guide dev -- --host 0.0.0.0 --port $GUIDE_PORT
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable --now chiba-cable-server chiba-cable-guide

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
  sudo mount -a
fi

# Install Playwright browsers (needed for weatherstar)
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
  pnpm -C "$REMOTE_DIR/cable/apps/server" exec playwright install --with-deps || true
fi

# Set kiosk URL to cable guide (via API + file fallback)
curl -sS -X POST http://localhost:8080/kiosk-url \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$KIOSK_URL\"}" >/dev/null || true
if [ ! -f "$REMOTE_DIR/.kiosk-url" ]; then
  echo "$KIOSK_URL" > "$REMOTE_DIR/.kiosk-url"
fi

echo "Bootstrap complete on $NODE_NAME"
EOF

printf "\nDone.\n"
