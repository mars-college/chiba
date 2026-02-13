#!/usr/bin/env bash
set -euo pipefail

# One-shot deploy from laptop -> prod server.
# - Sync repo (including local secret env files)
# - Install runtime dependencies on remote host
# - Install/build workspace
# - Start stack in tmux (session: chiba)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CABLE2_DIR="$REPO_ROOT/cable2"

HOST="${CHIBA_PROD_HOST:-10.10.13.9}"
PORT="${CHIBA_PROD_PORT:-38764}"
USER_NAME="${CHIBA_PROD_USER:-jmill}"
REMOTE_DIR="${CHIBA_PROD_DIR:-/home/${USER_NAME}/chiba}"
ENV_FILE_REL="${CHIBA_PROD_ENV_FILE:-cable2/.env.pis.prod}"
SSH_TARGET="${USER_NAME}@${HOST}"

usage() {
  cat <<EOF
Usage:
  $0 [--host HOST] [--port PORT] [--user USER] [--remote-dir DIR] [--env-file RELPATH]

Defaults:
  --host       ${HOST}
  --port       ${PORT}
  --user       ${USER_NAME}
  --remote-dir ${REMOTE_DIR}
  --env-file   ${ENV_FILE_REL}

Examples:
  $0
  $0 --host 10.10.13.9 --port 38764 --user jmill
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --host=*) HOST="${1#*=}"; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --user) USER_NAME="$2"; shift 2 ;;
    --user=*) USER_NAME="${1#*=}"; shift ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --remote-dir=*) REMOTE_DIR="${1#*=}"; shift ;;
    --env-file) ENV_FILE_REL="$2"; shift 2 ;;
    --env-file=*) ENV_FILE_REL="${1#*=}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

SSH_TARGET="${USER_NAME}@${HOST}"
LOCAL_ENV_FILE="${REPO_ROOT}/${ENV_FILE_REL}"
REMOTE_ENV_FILE="${REMOTE_DIR}/${ENV_FILE_REL}"

if [ ! -f "$LOCAL_ENV_FILE" ]; then
  echo "Missing env file: $LOCAL_ENV_FILE"
  echo "Create it first (shared key, NAS creds, Eden key, control-plane URLs)."
  exit 1
fi

echo "==> Syncing repo to ${SSH_TARGET}:${REMOTE_DIR}"
rsync -az --delete \
  --rsync-path="mkdir -p '${REMOTE_DIR}' && rsync" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '**/node_modules/' \
  --exclude '.pnpm-store/' \
  --exclude '**/.pnpm-store/' \
  --exclude 'dist/' \
  --exclude '**/dist/' \
  --exclude 'build/' \
  --exclude '**/build/' \
  --exclude '.vite/' \
  --exclude '**/.vite/' \
  --exclude 'media/' \
  --exclude 'media-cache/' \
  --exclude 'data/' \
  --exclude '*.log' \
  -e "ssh -p ${PORT}" \
  "${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_DIR}/"

echo "==> Provisioning + starting stack on ${SSH_TARGET}"
ssh -p "${PORT}" "${SSH_TARGET}" bash -s <<EOF
set -euo pipefail

sudo apt-get update -y
sudo apt-get install -y curl ca-certificates git build-essential jq tmux docker.io docker-compose-plugin

if ! command -v node >/dev/null 2>&1 || [ "\$(node -v | sed -E 's/^v([0-9]+).*/\\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

corepack enable
corepack prepare pnpm@9 --activate

cd "${REMOTE_DIR}"
chmod 600 "${REMOTE_ENV_FILE}" || true

pnpm -C cable2 install --no-frozen-lockfile
pnpm -C cable2 build

tmux kill-session -t chiba 2>/dev/null || true
tmux new-session -d -s chiba "cd '${REMOTE_DIR}/cable2' && set -a; source './.env.pis.prod'; set +a; pnpm dev:local:prod"
EOF

echo ""
echo "Done."
echo "Ops: http://${HOST}:8787/ops"
echo "Control-plane: http://${HOST}:8790/health"
echo "SSH logs: ssh -p ${PORT} ${SSH_TARGET} 'tmux attach -t chiba'"
