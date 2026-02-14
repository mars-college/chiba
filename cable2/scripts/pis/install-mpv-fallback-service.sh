#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

NODE_ID=""
RUN_USER="pi"
REGISTRY_PATH="$REPO_ROOT/cable2/config/registry.prod.toml"
PROFILE_PATH="$REPO_ROOT/cable2/config/profiles/midterms-gallery.toml"
CONFIG_ROOT="$REPO_ROOT/cable2/config"
CACHE_DIR="/var/lib/chiba-mpv-fallback/cache"
STATE_DIR="/var/lib/chiba-mpv-fallback/state"
PATH_MAP="/Volumes/share=/mnt/share"
IMAGE_SECONDS="12"
NAS_HOST=""
NAS_SHARE="share"
NAS_MOUNT="/mnt/share"
NAS_USER=""
NAS_PASSWORD=""
NO_ENABLE=0
NO_START=0
KEEP_CABLE_DISPLAY=0

ENV_FILE="/etc/chiba-mpv-fallback.env"
WRAPPER_PATH="/usr/local/bin/chiba-mpv-fallback-run"
SERVICE_PATH="/etc/systemd/system/chiba-mpv-fallback.service"

disable_tty1_kiosk_autostart() {
  local user_home profile_path
  user_home="$(getent passwd "$RUN_USER" | cut -d: -f6 || true)"
  if [ -z "$user_home" ]; then
    return
  fi
  profile_path="$user_home/.bash_profile"
  if [ ! -f "$profile_path" ]; then
    return
  fi
  if ! grep -q "run-kiosk.sh" "$profile_path"; then
    return
  fi

  cp "$profile_path" "$profile_path.pre-mpv-fallback.bak" || true

  # Comment the legacy tty1 kiosk autostart block so mpv can own display output.
  sed -i.bak \
    '/^# Chiba kiosk auto-start (only on TTY1)$/,/^fi$/ s/^/# /' \
    "$profile_path" || true

  chown "$RUN_USER":"$RUN_USER" "$profile_path" "$profile_path.pre-mpv-fallback.bak" "$profile_path.bak" 2>/dev/null || true
}

usage() {
  cat <<EOF
Usage:
  sudo $0 --node-id <registry-pi-id> [options]

Options:
  --node-id ID
  --run-user USER                (default: pi)
  --registry PATH                (default: $REGISTRY_PATH)
  --profile PATH                 (default: $PROFILE_PATH)
  --config-root PATH             (default: $CONFIG_ROOT)
  --cache-dir PATH               (default: $CACHE_DIR)
  --state-dir PATH               (default: $STATE_DIR)
  --path-map FROM=TO             (default: $PATH_MAP)
  --image-seconds N              (default: $IMAGE_SECONDS)
  --nas-host HOST                Optional NAS host for /mnt/share mount
  --nas-share SHARE              Optional NAS share name (default: $NAS_SHARE)
  --nas-mount PATH               Optional NAS mount point (default: $NAS_MOUNT)
  --nas-user USER                Optional NAS username
  --nas-password PASS            Optional NAS password
  --keep-cable-display           Do not disable chiba-kiosk/chiba-cable-guide
  --no-enable                    Do not enable service at boot
  --no-start                     Do not start/restart service now
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --node-id)
      NODE_ID="$2"
      shift 2
      ;;
    --node-id=*)
      NODE_ID="${1#*=}"
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
    --cache-dir)
      CACHE_DIR="$2"
      shift 2
      ;;
    --cache-dir=*)
      CACHE_DIR="${1#*=}"
      shift
      ;;
    --state-dir)
      STATE_DIR="$2"
      shift 2
      ;;
    --state-dir=*)
      STATE_DIR="${1#*=}"
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
    --nas-host)
      NAS_HOST="$2"
      shift 2
      ;;
    --nas-host=*)
      NAS_HOST="${1#*=}"
      shift
      ;;
    --nas-share)
      NAS_SHARE="$2"
      shift 2
      ;;
    --nas-share=*)
      NAS_SHARE="${1#*=}"
      shift
      ;;
    --nas-mount)
      NAS_MOUNT="$2"
      shift 2
      ;;
    --nas-mount=*)
      NAS_MOUNT="${1#*=}"
      shift
      ;;
    --nas-user)
      NAS_USER="$2"
      shift 2
      ;;
    --nas-user=*)
      NAS_USER="${1#*=}"
      shift
      ;;
    --nas-password)
      NAS_PASSWORD="$2"
      shift 2
      ;;
    --nas-password=*)
      NAS_PASSWORD="${1#*=}"
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
      echo "Unknown arg: $1"
      usage
      ;;
  esac
done

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root (sudo required)."
  exit 1
fi

if [ -z "$NODE_ID" ]; then
  echo "--node-id is required"
  usage
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "Run user does not exist: $RUN_USER"
  exit 1
fi

LAUNCHER_PATH="$REPO_ROOT/cable2/scripts/pis/fallback-mpv-launcher.py"
if [ ! -f "$LAUNCHER_PATH" ]; then
  echo "Missing launcher script: $LAUNCHER_PATH"
  exit 1
fi

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

echo "Installing runtime dependencies (mpv, python3, curl)..."
apt-get update -y
apt-get install -y mpv python3 curl ca-certificates

echo "Creating cache/state directories..."
mkdir -p "$CACHE_DIR" "$STATE_DIR"
chown -R "$RUN_USER":"$RUN_USER" "$CACHE_DIR" "$STATE_DIR"

cat > "$ENV_FILE" <<EOF
CHIBA_NODE_ID=$NODE_ID
CHIBA_RUN_USER=$RUN_USER
CHIBA_REGISTRY=$REGISTRY_PATH
CHIBA_PROFILE=$PROFILE_PATH
CHIBA_CONFIG_ROOT=$CONFIG_ROOT
CHIBA_CACHE_DIR=$CACHE_DIR
CHIBA_STATE_DIR=$STATE_DIR
CHIBA_PATH_MAP=$PATH_MAP
CHIBA_IMAGE_SECONDS=$IMAGE_SECONDS
CHIBA_FALLBACK_LAUNCHER=$LAUNCHER_PATH
EOF
chmod 0644 "$ENV_FILE"

cat > "$WRAPPER_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/chiba-mpv-fallback.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${CHIBA_NODE_ID:?missing CHIBA_NODE_ID}"
: "${CHIBA_REGISTRY:?missing CHIBA_REGISTRY}"
: "${CHIBA_PROFILE:?missing CHIBA_PROFILE}"
: "${CHIBA_CONFIG_ROOT:?missing CHIBA_CONFIG_ROOT}"
: "${CHIBA_CACHE_DIR:?missing CHIBA_CACHE_DIR}"
: "${CHIBA_STATE_DIR:?missing CHIBA_STATE_DIR}"
: "${CHIBA_FALLBACK_LAUNCHER:?missing CHIBA_FALLBACK_LAUNCHER}"

ARGS=(
  --node-id "$CHIBA_NODE_ID"
  --registry "$CHIBA_REGISTRY"
  --profile "$CHIBA_PROFILE"
  --config-root "$CHIBA_CONFIG_ROOT"
  --cache-dir "$CHIBA_CACHE_DIR"
  --state-dir "$CHIBA_STATE_DIR"
  --image-seconds "${CHIBA_IMAGE_SECONDS:-12}"
  --run
)

if [ -n "${CHIBA_PATH_MAP:-}" ]; then
  ARGS+=(--path-map "$CHIBA_PATH_MAP")
fi

exec /usr/bin/env python3 "$CHIBA_FALLBACK_LAUNCHER" "${ARGS[@]}"
EOF
chmod 0755 "$WRAPPER_PATH"

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Chiba MPV Fallback Player
After=network-online.target
Wants=network-online.target
Conflicts=chiba-kiosk.service chiba-cable-guide.service

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
EnvironmentFile=-$ENV_FILE
ExecStart=$WRAPPER_PATH
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$SERVICE_PATH"

systemctl daemon-reload

if [ "$KEEP_CABLE_DISPLAY" -eq 0 ]; then
  echo "Disabling conflicting Cable display services (kiosk/guide)..."
  for svc in chiba-kiosk.service chiba-cable-guide.service; do
    if systemctl cat "$svc" >/dev/null 2>&1; then
      systemctl disable --now "$svc" >/dev/null 2>&1 || true
    fi
  done

  echo "Disabling desktop display managers for DRM-backed mpv fallback..."
  for svc in display-manager.service lightdm.service lxdm.service gdm.service gdm3.service sddm.service; do
    if systemctl cat "$svc" >/dev/null 2>&1; then
      systemctl disable --now "$svc" >/dev/null 2>&1 || true
    fi
  done
  systemctl set-default multi-user.target >/dev/null 2>&1 || true

  # Make sure stale kiosk display processes are gone before fallback starts.
  pkill -f "run-kiosk.sh" >/dev/null 2>&1 || true
  pkill -f "cage -s -- /usr/bin/chromium" >/dev/null 2>&1 || true
  pkill -f "cage -s -- /usr/bin/chromium-browser" >/dev/null 2>&1 || true
  pkill -f "xinit /tmp/chiba-xsession" >/dev/null 2>&1 || true
  pkill -f "chromium --kiosk" >/dev/null 2>&1 || true
  pkill -f "chromium-browser --kiosk" >/dev/null 2>&1 || true
  pkill -f "/usr/lib/chromium/chromium --kiosk" >/dev/null 2>&1 || true
  pkill -f "Xorg :0" >/dev/null 2>&1 || true
  pkill -f "lightdm" >/dev/null 2>&1 || true
  pkill -f "labwc" >/dev/null 2>&1 || true
  pkill -f "wayfire" >/dev/null 2>&1 || true
  pkill -f "wf-panel-pi" >/dev/null 2>&1 || true
  pkill -f "pcmanfm --desktop" >/dev/null 2>&1 || true

  disable_tty1_kiosk_autostart
fi

# Prevent reboot loops on fallback nodes if an old bootstrap left auto-reboot enabled.
# Keep watchdog available for lightweight network recovery, but clear reboot trigger.
if systemctl cat chiba-network-watchdog.service >/dev/null 2>&1; then
  echo "Clearing network watchdog auto-reboot flag..."
  rm -f /var/tmp/chiba-auto-reboot-enabled /var/tmp/chiba-network-failures
  systemctl restart chiba-network-watchdog.service >/dev/null 2>&1 || true
fi

if [ -n "$NAS_HOST" ] && [ -n "$NAS_USER" ] && [ -n "$NAS_PASSWORD" ]; then
  echo "Configuring NAS mount at $NAS_MOUNT from //$NAS_HOST/$NAS_SHARE ..."
  apt-get install -y cifs-utils
  mkdir -p "$NAS_MOUNT" /etc/samba /Volumes
  cat > /etc/samba/credentials-chiba-nas <<EOF
username=$NAS_USER
password=$NAS_PASSWORD
EOF
  chmod 600 /etc/samba/credentials-chiba-nas
  if ! grep -q "credentials-chiba-nas" /etc/fstab; then
    echo "//$NAS_HOST/$NAS_SHARE $NAS_MOUNT cifs credentials=/etc/samba/credentials-chiba-nas,iocharset=utf8,uid=$RUN_USER,gid=$RUN_USER,file_mode=0775,dir_mode=0775,nofail,x-systemd.automount 0 0" >> /etc/fstab
  fi
  mount -a || true
  if [ "$NAS_MOUNT" != "/Volumes/share" ]; then
    if [ -L /Volumes/share ] || [ ! -e /Volumes/share ]; then
      ln -sfn "$NAS_MOUNT" /Volumes/share
    elif [ -d /Volumes/share ]; then
      # Leave existing directory/mountpoint intact; launcher path-map resolves /Volumes/share -> /mnt/share.
      :
    fi
  fi
fi

if [ "$NO_ENABLE" -eq 0 ]; then
  systemctl enable chiba-mpv-fallback.service
fi

if [ "$NO_START" -eq 0 ]; then
  systemctl restart chiba-mpv-fallback.service
fi

echo "Installed: chiba-mpv-fallback.service"
systemctl --no-pager --full status chiba-mpv-fallback.service | sed -n '1,25p' || true
echo "Service states:"
for svc in chiba-kiosk.service chiba-cable-guide.service lightdm.service display-manager.service chiba-mpv-fallback.service; do
  printf "  %s enabled=%s active=%s\n" \
    "$svc" \
    "$(systemctl is-enabled "$svc" 2>/dev/null || echo unknown)" \
    "$(systemctl is-active "$svc" 2>/dev/null || echo unknown)"
done
