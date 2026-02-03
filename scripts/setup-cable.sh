#!/bin/bash
# Chiba Cable Setup Script (run on the Pi)
# - Clones or updates chiba-cable
# - Installs deps
# - Creates systemd services for server + guide
#
# Usage:
#   ./scripts/setup-cable.sh --guide-port 5173 --server-port 8787

set -e

INSTALL_DIR="/home/pi/chiba-cable"
REPO_URL="https://github.com/mars-college/chiba-cable.git"
BRANCH="main"
GUIDE_PORT="5173"
SERVER_PORT="8787"
REMOTE_URL=""

while [ $# -gt 0 ]; do
  case $1 in
    --install-dir=*)
      INSTALL_DIR="${1#*=}"
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --repo-url=*)
      REPO_URL="${1#*=}"
      shift
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --branch=*)
      BRANCH="${1#*=}"
      shift
      ;;
    --branch)
      BRANCH="$2"
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
      echo "Usage: $0 [--install-dir DIR] [--repo-url URL] [--branch BRANCH] [--guide-port PORT] [--server-port PORT] [--remote-url URL]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "=== Chiba Cable setup ==="
echo "Install dir:  $INSTALL_DIR"
echo "Repo:         $REPO_URL"
echo "Branch:       $BRANCH"
echo "Guide port:   $GUIDE_PORT"
echo "Server port:  $SERVER_PORT"
if [ -n "$REMOTE_URL" ]; then
  echo "Remote URL:   $REMOTE_URL"
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "Cloning chiba-cable..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  echo "Updating chiba-cable..."
  git -C "$INSTALL_DIR" fetch --all
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR"

if command -v corepack >/dev/null 2>&1; then
  corepack enable || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found; installing..."
  npm install -g pnpm
fi

pnpm install

SERVER_ENV=""
if [ -n "$REMOTE_URL" ]; then
  SERVER_ENV="Environment=CHIBA_REMOTE_URL=$REMOTE_URL"
fi

echo "Writing systemd services..."
sudo tee /etc/systemd/system/chiba-cable-server.service > /dev/null << EOF
[Unit]
Description=Chiba Cable Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$INSTALL_DIR
Environment=CHIBA_CONFIG=$INSTALL_DIR/config/chiba.toml
Environment=PORT=$SERVER_PORT
$SERVER_ENV
ExecStart=/usr/bin/env bash -lc 'cd $INSTALL_DIR && pnpm -C apps/server dev'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/chiba-cable-guide.service > /dev/null << EOF
[Unit]
Description=Chiba Cable Guide
After=network.target chiba-cable-server.service

[Service]
Type=simple
User=pi
WorkingDirectory=$INSTALL_DIR
Environment=PORT=$GUIDE_PORT
ExecStart=/usr/bin/env bash -lc 'cd $INSTALL_DIR && pnpm -C apps/guide dev -- --host 0.0.0.0 --port $GUIDE_PORT'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now chiba-cable-server.service chiba-cable-guide.service

echo "Chiba Cable services started."
echo "Server: http://localhost:$SERVER_PORT"
echo "Guide:  http://localhost:$GUIDE_PORT"
