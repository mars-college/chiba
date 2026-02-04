#!/bin/bash
# Bootstrap a Pi with Chiba + Chiba Cable over SSH
#
# Usage:
#   ./scripts/bootstrap-cable-pi.sh --host mars01.local --controller-url http://192.168.1.10:8080 --node-name living-room

set -e

PI_HOST=""
PI_USER="pi"
CONTROLLER_URL=""
NODE_NAME=""
GUIDE_PORT="5173"
SERVER_PORT="8787"
REMOTE_URL=""

while [ $# -gt 0 ]; do
  case $1 in
    --host=*)
      PI_HOST="${1#*=}"
      shift
      ;;
    --host)
      PI_HOST="$2"
      shift 2
      ;;
    --user=*)
      PI_USER="${1#*=}"
      shift
      ;;
    --user)
      PI_USER="$2"
      shift 2
      ;;
    --controller-url=*)
      CONTROLLER_URL="${1#*=}"
      shift
      ;;
    --controller-url)
      CONTROLLER_URL="$2"
      shift 2
      ;;
    --node-name=*)
      NODE_NAME="${1#*=}"
      shift
      ;;
    --node-name)
      NODE_NAME="$2"
      shift 2
      ;;
    --guide-port=*)
      GUIDE_PORT="${1#*=}"
      shift
      ;;
    --guide-port)
      GUIDE_PORT="$2"
      shift 2
      ;;
    --server-port=*)
      SERVER_PORT="${1#*=}"
      shift
      ;;
    --server-port)
      SERVER_PORT="$2"
      shift 2
      ;;
    --remote-url=*)
      REMOTE_URL="${1#*=}"
      shift
      ;;
    --remote-url)
      REMOTE_URL="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 --host HOST --controller-url URL --node-name NAME [--guide-port PORT] [--server-port PORT] [--remote-url URL]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -z "$PI_HOST" ] || [ -z "$CONTROLLER_URL" ] || [ -z "$NODE_NAME" ]; then
  echo "Missing required args."
  echo "Usage: $0 --host HOST --controller-url URL --node-name NAME"
  exit 1
fi

SSH_TARGET="${PI_USER}@${PI_HOST}"
REMOTE_URL_ARG=""
if [ -n "$REMOTE_URL" ]; then
  REMOTE_URL_ARG="--remote-url ${REMOTE_URL}"
fi

echo "Bootstrapping ${SSH_TARGET}..."

ssh "$SSH_TARGET" bash -s << EOF
set -e

if [ ! -d /home/pi/chiba ]; then
  echo "Installing Chiba node..."
  curl -sL "https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh?v=\$(date +%s)" | bash -s -- \
    --controller-url ${CONTROLLER_URL} \
    --node-name ${NODE_NAME}
else
  echo "Updating Chiba node..."
  cd /home/pi/chiba
  git pull --ff-only
  ./scripts/upgrade-node.sh soft
fi

cd /home/pi/chiba
./scripts/setup-cable.sh --guide-port ${GUIDE_PORT} --server-port ${SERVER_PORT} ${REMOTE_URL_ARG}

echo "Setting kiosk URL..."
curl -X POST http://localhost:8080/kiosk-url -d '{"url":"http://localhost:${GUIDE_PORT}/?screenId=${NODE_NAME}"}'

echo "Bootstrap complete."
EOF
