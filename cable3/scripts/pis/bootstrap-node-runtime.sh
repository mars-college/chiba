#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat <<'USAGE'
Usage:
  ./cable3/scripts/pis/bootstrap-node-runtime.sh <node-id> [options]

Options:
  --control-api-url <url>     Control API URL used for node lookup (default: $CHIBA3_CONTROL_API_URL or http://127.0.0.1:8795)
  --node-control-api-url <url> Control API URL written into node runtime env (default: --control-api-url value)
  --registry-id <id>          Registry id in DB (optional; auto-discovered if omitted)
  --registry <path>           Optional TOML fallback (legacy path only)
  --host <host-or-ip>         Force target host/ip (skip API/registry lookup)
  --ssh-user <user>           SSH user (default: pi)
  --ssh-port <port>           SSH port (default: 22)
  --ssh-password <password>   SSH password (default: $CHIBA3_SSH_PASSWORD)
  --namespace <name>          Runtime namespace (optional; inferred from registry when omitted)
  --remote-dir <path>         Remote working dir (default: /home/<ssh-user>/chiba-cable3)
  --node-port <port>          Node API port (default: 8080)
  --server-port <port>        Server API port (default: 8787)
  --guide-port <port>         Guide port used in kiosk URL (default: 5173)
  --guide-base-url <url>      Guide base URL used by node kiosk links (default: derived from node control API host + guide-port)
  --endpoints-only            Update runtime endpoint env + restart service (skip rsync/install/build)
  --mpv-bin <bin>             mpv binary (default: mpv)
  --mpv-max-height <pixels>   Optional max output height cap for mpv (default: node-runtime auto)
  --switch-overlap-ms <ms>    Keep previous fullscreen backend alive during handoff (default: runtime default)
USAGE
  exit 1
fi

NODE_ID="$1"
shift

LOOKUP_CONTROL_API_URL="${CHIBA3_CONTROL_API_URL:-http://127.0.0.1:8795}"
NODE_CONTROL_API_URL="${CHIBA3_NODE_CONTROL_API_URL:-${CHIBA3_RUNTIME_CONTROL_API_URL:-$LOOKUP_CONTROL_API_URL}}"
REGISTRY_ID="${CHIBA3_REGISTRY_ID:-}"
REGISTRY_PATH=""
HOST_OVERRIDE=""
SSH_USER="pi"
SSH_PORT="22"
SSH_PASSWORD="${CHIBA3_SSH_PASSWORD:-}"
NAMESPACE="${CHIBA3_NAMESPACE:-}"
REMOTE_DIR=""
NODE_PORT="8080"
SERVER_PORT="8787"
GUIDE_PORT="5173"
GUIDE_BASE_URL="${CHIBA3_GUIDE_BASE_URL:-}"
MPV_BIN="mpv"
MPV_MAX_HEIGHT="${CHIBA3_MPV_MAX_HEIGHT:-}"
SWITCH_OVERLAP_MS="${CHIBA3_SWITCH_OVERLAP_MS:-}"
ENDPOINTS_ONLY=0
NODE_PORT_SET=0
SERVER_PORT_SET=0
GUIDE_PORT_SET=0
NODE_CONTROL_API_URL_SET=0
GUIDE_BASE_URL_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --control-api-url)
      LOOKUP_CONTROL_API_URL="$2"
      if [[ "$NODE_CONTROL_API_URL_SET" -eq 0 ]]; then
        NODE_CONTROL_API_URL="$2"
      fi
      shift 2
      ;;
    --node-control-api-url)
      NODE_CONTROL_API_URL="$2"
      NODE_CONTROL_API_URL_SET=1
      shift 2
      ;;
    --registry-id)
      REGISTRY_ID="$2"
      shift 2
      ;;
    --registry)
      REGISTRY_PATH="$2"
      shift 2
      ;;
    --host)
      HOST_OVERRIDE="$2"
      shift 2
      ;;
    --ssh-user)
      SSH_USER="$2"
      shift 2
      ;;
    --ssh-port)
      SSH_PORT="$2"
      shift 2
      ;;
    --ssh-password)
      SSH_PASSWORD="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="$2"
      shift 2
      ;;
    --node-port)
      NODE_PORT="$2"
      NODE_PORT_SET=1
      shift 2
      ;;
    --server-port)
      SERVER_PORT="$2"
      SERVER_PORT_SET=1
      shift 2
      ;;
    --guide-port)
      GUIDE_PORT="$2"
      GUIDE_PORT_SET=1
      shift 2
      ;;
    --guide-base-url)
      GUIDE_BASE_URL="$2"
      GUIDE_BASE_URL_SET=1
      shift 2
      ;;
    --endpoints-only)
      ENDPOINTS_ONLY=1
      shift
      ;;
    --mpv-bin)
      MPV_BIN="$2"
      shift 2
      ;;
    --mpv-max-height)
      MPV_MAX_HEIGHT="$2"
      shift 2
      ;;
    --switch-overlap-ms)
      SWITCH_OVERLAP_MS="$2"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$REMOTE_DIR" ]]; then
  REMOTE_DIR="/home/${SSH_USER}/chiba-cable3"
fi

if [[ -n "$SSH_PASSWORD" ]] && ! command -v sshpass >/dev/null 2>&1; then
  echo "CHIBA3_SSH_PASSWORD/--ssh-password set, but sshpass is not installed." >&2
  echo "Install sshpass (e.g. 'brew install hudochenkov/sshpass/sshpass')." >&2
  exit 1
fi

ssh_cmd() {
  if [[ -n "$SSH_PASSWORD" ]]; then
    SSHPASS="$SSH_PASSWORD" sshpass -e ssh \
      -o StrictHostKeyChecking=accept-new \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      -p "$SSH_PORT" \
      "$@"
    return
  fi
  ssh -o StrictHostKeyChecking=accept-new -p "$SSH_PORT" "$@"
}

rsync_cmd() {
  if [[ -n "$SSH_PASSWORD" ]]; then
    SSHPASS="$SSH_PASSWORD" rsync \
      -e "sshpass -e ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no -p ${SSH_PORT}" \
      "$@"
    return
  fi
  rsync -e "ssh -o StrictHostKeyChecking=accept-new -p ${SSH_PORT}" "$@"
}

TARGET_HOST=""
API_NODE_PORT=""
API_SERVER_PORT=""
API_GUIDE_PORT=""
DISCOVERED_REGISTRY_ID=""
declare -a DISCOVERY_REGISTRY_CANDIDATES=()

lookup_api_node() {
    local query_namespace="$1"
    local query_registry="$2"
    python3 - "$LOOKUP_CONTROL_API_URL" "$NODE_ID" "$query_namespace" "$query_registry" <<'PY'
import json
import sys
import urllib.parse
import urllib.request

base_url = sys.argv[1].rstrip("/")
node_id = sys.argv[2]
namespace = sys.argv[3]
registry_id = sys.argv[4]
params = {"namespace": namespace}
if registry_id:
    params["registryId"] = registry_id
url = f"{base_url}/api/ops/nodes?{urllib.parse.urlencode(params)}"

try:
    with urllib.request.urlopen(url, timeout=12) as resp:
        payload = json.load(resp)
except Exception:
    print("")
    raise SystemExit(0)

nodes = payload.get("nodes") if isinstance(payload, dict) else None
if not isinstance(nodes, list):
    print("")
    raise SystemExit(0)

for row in nodes:
    if str(row.get("nodeId", "")).strip() != node_id:
        continue
    host = str((row.get("ip") or row.get("host") or "")).strip()
    if not host:
        print("")
        raise SystemExit(0)

    def int_str(value):
        try:
            return str(int(value))
        except Exception:
            return ""

    node_port = int_str(row.get("nodePort"))
    server_port = int_str(row.get("serverPort"))
    guide_port = int_str(row.get("guidePort"))
    resolved_registry_id = str(row.get("registryId") or registry_id or "").strip()
    print("\n".join([host, node_port, server_port, guide_port, resolved_registry_id]))
    raise SystemExit(0)

print("")
PY
}

add_candidate() {
  local candidate="$1"
  [[ -n "$candidate" ]] || return 0
  local existing
  for existing in "${DISCOVERY_REGISTRY_CANDIDATES[@]-}"; do
    if [[ "$existing" == "$candidate" ]]; then
      return 0
    fi
  done
  DISCOVERY_REGISTRY_CANDIDATES+=("$candidate")
}

DISCOVERY_REGISTRY_CANDIDATES=()
if [[ -n "$REGISTRY_ID" ]]; then
  add_candidate "$REGISTRY_ID"
else
  add_candidate "$NAMESPACE"
  add_candidate "local"
  add_candidate "prod"
fi

API_RESOLVED_HOST=""
for candidate_registry in "${DISCOVERY_REGISTRY_CANDIDATES[@]}"; do
  query_namespace="$NAMESPACE"
  if [[ -z "$query_namespace" ]]; then
    query_namespace="$candidate_registry"
  fi

  API_RESULT="$(lookup_api_node "$query_namespace" "$candidate_registry")"
  if [[ -z "$API_RESULT" ]]; then
    continue
  fi

  API_FIELDS=()
  while IFS= read -r line; do
    API_FIELDS+=("$line")
  done <<<"$API_RESULT"
  API_RESOLVED_HOST="${API_FIELDS[0]:-}"
  API_NODE_PORT="${API_FIELDS[1]:-}"
  API_SERVER_PORT="${API_FIELDS[2]:-}"
  API_GUIDE_PORT="${API_FIELDS[3]:-}"
  DISCOVERED_REGISTRY_ID="${API_FIELDS[4]:-$candidate_registry}"
  if [[ -n "$API_RESOLVED_HOST" ]]; then
    break
  fi
done

if [[ -n "$HOST_OVERRIDE" ]]; then
  TARGET_HOST="$HOST_OVERRIDE"
elif [[ -n "$API_RESOLVED_HOST" ]]; then
  TARGET_HOST="$API_RESOLVED_HOST"
fi

if [[ -z "$TARGET_HOST" && -n "$REGISTRY_PATH" ]]; then
  REGISTRY_ABS="$(cd "$(dirname "$REGISTRY_PATH")" && pwd)/$(basename "$REGISTRY_PATH")"
  if [[ ! -f "$REGISTRY_ABS" ]]; then
    echo "Registry fallback not found: $REGISTRY_ABS" >&2
    exit 1
  fi
  TARGET_HOST="$(
    python3 - "$REGISTRY_ABS" "$NODE_ID" <<'PY'
import sys, tomllib
registry_path = sys.argv[1]
node_id = sys.argv[2]
with open(registry_path, "rb") as f:
    data = tomllib.load(f)
pis = data.get("pis", {})
node = pis.get(node_id)
if not isinstance(node, dict):
    print("")
    raise SystemExit(1)
host = node.get("ip") or node.get("host") or ""
print(host)
PY
  )" || {
    echo "Could not resolve node '$NODE_ID' from registry fallback $REGISTRY_ABS" >&2
    exit 1
  }
fi

if [[ -z "$TARGET_HOST" ]]; then
  echo "Could not resolve host/ip for node '$NODE_ID' from API ${LOOKUP_CONTROL_API_URL}/api/ops/nodes." >&2
  echo "Tried registry ids: ${DISCOVERY_REGISTRY_CANDIDATES[*]:-none}" >&2
  echo "Provide --host <ip|host> or --registry <path> for legacy fallback." >&2
  exit 1
fi

if [[ -z "$REGISTRY_ID" && -n "$DISCOVERED_REGISTRY_ID" ]]; then
  REGISTRY_ID="$DISCOVERED_REGISTRY_ID"
fi
if [[ -n "$HOST_OVERRIDE" && -z "$REGISTRY_ID" && -z "$NAMESPACE" ]]; then
  echo "Host override was provided, but registry/namespace could not be discovered." >&2
  echo "Provide --registry-id <id> or --namespace <name> to avoid ambiguous defaults." >&2
  exit 1
fi
if [[ -z "$NAMESPACE" ]]; then
  NAMESPACE="${REGISTRY_ID:-prod}"
fi

if [[ "$NODE_PORT_SET" -eq 0 && -n "$API_NODE_PORT" ]]; then
  NODE_PORT="$API_NODE_PORT"
fi
if [[ "$SERVER_PORT_SET" -eq 0 && -n "$API_SERVER_PORT" ]]; then
  SERVER_PORT="$API_SERVER_PORT"
fi
if [[ "$GUIDE_PORT_SET" -eq 0 && -n "$API_GUIDE_PORT" ]]; then
  GUIDE_PORT="$API_GUIDE_PORT"
fi
if [[ "$GUIDE_BASE_URL_SET" -eq 0 && -z "$GUIDE_BASE_URL" ]]; then
  GUIDE_BASE_URL="$(
    python3 - "$NODE_CONTROL_API_URL" "$GUIDE_PORT" <<'PY'
import sys
from urllib.parse import urlparse

api_url = sys.argv[1].strip()
guide_port = sys.argv[2].strip()
try:
    parsed = urlparse(api_url)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("invalid")
    print(f"{parsed.scheme}://{parsed.hostname}:{guide_port}")
except Exception:
    print(f"http://localhost:{guide_port}")
PY
  )"
fi

SSH_TARGET="${SSH_USER}@${TARGET_HOST}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WATCHDOG_SCRIPT="${ROOT_DIR}/scripts/pis/network-watchdog.sh"

if [[ ! -f "$WATCHDOG_SCRIPT" ]]; then
  echo "Missing watchdog script: $WATCHDOG_SCRIPT" >&2
  exit 1
fi

echo "Bootstrapping node-runtime for ${NODE_ID} (${SSH_TARGET})..."
echo "Resolved: namespace=${NAMESPACE} registryId=${REGISTRY_ID:-unknown} ports(node=${NODE_PORT},server=${SERVER_PORT},guide=${GUIDE_PORT})"
echo "Runtime endpoints: controlApi=${NODE_CONTROL_API_URL} guideBase=${GUIDE_BASE_URL} switchOverlapMs=${SWITCH_OVERLAP_MS:-runtime-default}"

if [[ "$ENDPOINTS_ONLY" -eq 1 ]]; then
  ssh_cmd "$SSH_TARGET" bash -s -- \
    "$NODE_CONTROL_API_URL" \
    "$GUIDE_PORT" \
    "$GUIDE_BASE_URL" \
    "$SWITCH_OVERLAP_MS" <<'REMOTE_ENDPOINTS_ONLY'
set -euo pipefail

NODE_CONTROL_API_URL="$1"
GUIDE_PORT="$2"
GUIDE_BASE_URL="$3"
SWITCH_OVERLAP_MS="${4:-}"

sudo install -d -m 0755 /etc/systemd/system/cable3-node-runtime.service.d
sudo tee /etc/systemd/system/cable3-node-runtime.service.d/10-endpoints.conf >/dev/null <<EOF
[Service]
Environment=CHIBA3_CONTROL_API_URL=${NODE_CONTROL_API_URL}
Environment=CHIBA3_GUIDE_PORT=${GUIDE_PORT}
Environment=CHIBA3_GUIDE_BASE_URL=${GUIDE_BASE_URL}
Environment=CHIBA3_SWITCH_OVERLAP_MS=${SWITCH_OVERLAP_MS}
EOF

sudo systemctl daemon-reload
sudo systemctl restart cable3-node-runtime
sudo systemctl --no-pager --full status cable3-node-runtime | sed -n "1,80p"
REMOTE_ENDPOINTS_ONLY

  echo "Done. Endpoint override applied without redeploy."
  echo "Verify:"
  echo "  curl -s http://${TARGET_HOST}:${NODE_PORT}/status"
  exit 0
fi

ssh_cmd "$SSH_TARGET" "mkdir -p ${REMOTE_DIR}/scripts/pis"

(
  cd "$ROOT_DIR"
  rsync_cmd -az --checksum --delete \
    --exclude ".DS_Store" \
    "package.json" \
    "pnpm-lock.yaml" \
    "pnpm-workspace.yaml" \
    "tsconfig.base.json" \
    "${SSH_TARGET}:${REMOTE_DIR}/"

  rsync_cmd -az --checksum --delete \
    --exclude ".DS_Store" \
    --exclude "node_modules" \
    --exclude "dist" \
    "packages/contracts" \
    "packages/node-runtime" \
    "${SSH_TARGET}:${REMOTE_DIR}/packages/"

  rsync_cmd -az --checksum --delete \
    --exclude ".DS_Store" \
    "scripts/pis/network-watchdog.sh" \
    "${SSH_TARGET}:${REMOTE_DIR}/scripts/pis/"
)

# Cleanup accidental absolute-path mirror from earlier bootstrap versions.
ssh_cmd "$SSH_TARGET" "rm -rf ${REMOTE_DIR}/Users"

ssh_cmd "$SSH_TARGET" bash -s -- \
  "$REMOTE_DIR" \
  "$SSH_USER" \
  "$NODE_CONTROL_API_URL" \
  "$NODE_ID" \
  "$NAMESPACE" \
  "$NODE_PORT" \
  "$SERVER_PORT" \
  "$GUIDE_PORT" \
  "$GUIDE_BASE_URL" \
  "$MPV_BIN" \
  "$MPV_MAX_HEIGHT" \
  "$SWITCH_OVERLAP_MS" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_DIR="$1"
SSH_USER="$2"
NODE_CONTROL_API_URL="$3"
NODE_ID="$4"
NAMESPACE="$5"
NODE_PORT="$6"
SERVER_PORT="$7"
GUIDE_PORT="$8"
GUIDE_BASE_URL="$9"
MPV_BIN="${10}"
MPV_MAX_HEIGHT="${11:-}"
SWITCH_OVERLAP_MS="${12:-}"

WATCHDOG_SCRIPT="${REMOTE_DIR}/scripts/pis/network-watchdog.sh"

apt_updated=0

apt_install() {
  if [[ "${apt_updated}" -eq 0 ]]; then
    sudo apt-get update
    apt_updated=1
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

cleanup_legacy_chiba() {
  local -a legacy_services
  legacy_services=(
    chiba-node.service
    chiba-node-agent.service
    chiba-cable-node.service
    chiba-network-watchdog.service
    chiba-cable-server.service
    chiba-cable-guide.service
    chiba-cable2-node-agent.service
    chiba-kiosk.service
    chiba-mpv-fallback.service
    disable-blanking.service
  )

  for svc in "${legacy_services[@]}"; do
    sudo systemctl disable --now "${svc}" >/dev/null 2>&1 || true
    sudo rm -f "/etc/systemd/system/${svc}"
    sudo rm -rf "/etc/systemd/system/${svc}.d"
    sudo systemctl reset-failed "${svc}" >/dev/null 2>&1 || true
  done

  sudo rm -f \
    /var/tmp/chiba-auto-reboot-enabled \
    /var/tmp/chiba-last-reboot \
    /var/tmp/chiba-reboot-count \
    /var/tmp/chiba-network-failures

  local legacy_dir
  for legacy_dir in \
    "/home/${SSH_USER}/chiba" \
    "/home/${SSH_USER}/chiba-cable" \
    "/home/${SSH_USER}/chiba-cable2" \
    "${REMOTE_DIR}"; do
    rm -f "${legacy_dir}/.kiosk-url" "${legacy_dir}/.kiosk_url" >/dev/null 2>&1 || true
  done

  rm -f \
    /tmp/chiba-kiosk-restart \
    /tmp/chiba-exit-kiosk \
    /tmp/chiba-rotate-signal >/dev/null 2>&1 || true
}

ensure_nodejs() {
  local node_major
  node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  fi
  if [[ "${node_major}" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    apt_install nodejs
  fi
}

ensure_pnpm() {
  command -v pnpm >/dev/null 2>&1 || sudo npm install -g pnpm@9
}

ensure_mpv() {
  command -v "${MPV_BIN}" >/dev/null 2>&1 || apt_install mpv
}

ensure_chromium_wrapper() {
  install -d -m 0755 "/home/${SSH_USER}/bin"
  cat > "/home/${SSH_USER}/bin/chromium-kiosk" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="${HOME}/.config/chiba-cable3/chromium-kiosk"
mkdir -p "${PROFILE_DIR}"
COMMON_FLAGS=(
  --ozone-platform=x11
  --disable-infobars
  --no-first-run
  --no-default-browser-check
  --disable-sync
  --disable-features=AutofillServerCommunication,PasswordManagerOnboarding
  --password-store=basic
  --user-data-dir="${PROFILE_DIR}"
)

exec /usr/bin/chromium \
  "${COMMON_FLAGS[@]}" \
  "$@"
EOF
  chmod +x "/home/${SSH_USER}/bin/chromium-kiosk"
}

ensure_graphical_session() {
  sudo systemctl set-default graphical.target >/dev/null 2>&1 || true
  if systemctl list-unit-files --type=service | awk '{print $1}' | grep -qx 'lightdm.service'; then
    sudo systemctl enable --now lightdm >/dev/null 2>&1 || true
    return
  fi
  if systemctl list-unit-files --type=service | awk '{print $1}' | grep -qx 'display-manager.service'; then
    sudo systemctl enable --now display-manager >/dev/null 2>&1 || true
  fi
}

install_units() {
  sudo install -d -m 0755 /var/lib/chiba-cable3
  sudo rm -f /var/lib/chiba-cable3/network-watchdog.state
  sudo rm -f /etc/systemd/system/cable3-node-runtime.service.d/20-display.conf
  chmod +x "${WATCHDOG_SCRIPT}"

  if ! sudo test -f /etc/default/cable3-network-watchdog; then
    sudo tee /etc/default/cable3-network-watchdog >/dev/null <<'EOF'
# Cable3 network watchdog defaults.
# Keep internet checks optional for static-IP + intermittent WAN environments.
CHECK_INTERNET=0
FAILURE_THRESHOLD=3
RECOVERY_COOLDOWN_SEC=120
PING_TIMEOUT=2
# INTERNET_TARGETS="1.1.1.1 8.8.8.8 9.9.9.9"
EOF
  fi

  sudo tee /etc/systemd/system/cable3-node-runtime.service >/dev/null <<EOF
[Unit]
Description=Cable3 Node Runtime
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=${SSH_USER}
WorkingDirectory=${REMOTE_DIR}
Environment=CHIBA3_CONTROL_API_URL=${NODE_CONTROL_API_URL}
Environment=CHIBA3_NODE_ID=${NODE_ID}
Environment=CHIBA3_NAMESPACE=${NAMESPACE}
Environment=CHIBA3_NODE_PORT=${NODE_PORT}
Environment=CHIBA3_SERVER_PORT=${SERVER_PORT}
Environment=CHIBA3_GUIDE_PORT=${GUIDE_PORT}
Environment=CHIBA3_GUIDE_BASE_URL=${GUIDE_BASE_URL}
Environment=CHIBA3_MPV_BIN=${MPV_BIN}
Environment=CHIBA3_MPV_MAX_HEIGHT=${MPV_MAX_HEIGHT}
Environment=CHIBA3_SWITCH_OVERLAP_MS=${SWITCH_OVERLAP_MS}
Environment=CHIBA3_CHROMIUM_BIN=/home/${SSH_USER}/bin/chromium-kiosk
Environment=CHIBA3_INPUT_BIN=xdotool
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
ExecStart=/usr/bin/env node ${REMOTE_DIR}/packages/node-runtime/dist/local-node.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  sudo tee /etc/systemd/system/cable3-network-watchdog.service >/dev/null <<EOF
[Unit]
Description=Cable3 Network Watchdog (no reboot loop)
After=network.target
Wants=network.target

[Service]
Type=oneshot
User=root
Group=root
EnvironmentFile=-/etc/default/cable3-network-watchdog
ExecStart=${WATCHDOG_SCRIPT}
EOF

  sudo tee /etc/systemd/system/cable3-network-watchdog.timer >/dev/null <<'EOF'
[Unit]
Description=Run Cable3 network watchdog periodically

[Timer]
OnBootSec=90
OnUnitActiveSec=45
AccuracySec=10
Persistent=true
Unit=cable3-network-watchdog.service

[Install]
WantedBy=timers.target
EOF
}

cd "${REMOTE_DIR}"
cleanup_legacy_chiba
ensure_nodejs
ensure_pnpm
ensure_mpv
ensure_chromium_wrapper
ensure_graphical_session

rm -rf node_modules packages/contracts/node_modules packages/node-runtime/node_modules
NODE_ENV=development pnpm install --filter @chiba-cable3/node-runtime... --filter @chiba-cable3/contracts... --frozen-lockfile=false
pnpm -C packages/contracts build
pnpm -C packages/node-runtime build

install_units

sudo systemctl daemon-reload
sudo systemctl enable --now cable3-network-watchdog.timer
sudo systemctl restart cable3-network-watchdog.service >/dev/null 2>&1 || true
sudo systemctl enable --now cable3-node-runtime
sudo systemctl restart cable3-node-runtime

sudo systemctl --no-pager --full status cable3-network-watchdog.timer | sed -n "1,30p"
sudo systemctl --no-pager --full status cable3-node-runtime | sed -n "1,80p"
REMOTE_SCRIPT

echo "Done. Verify:"
echo "  curl -s http://${TARGET_HOST}:${NODE_PORT}/status"
echo "  ssh -p ${SSH_PORT} ${SSH_TARGET} 'journalctl -u cable3-network-watchdog.service -n 60 --no-pager'"
