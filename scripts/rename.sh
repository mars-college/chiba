#!/bin/bash
# Rename a Chiba node's friendly name
#
# Usage:
#   ./rename.sh <hostname> <new-name>
#
# Examples:
#   ./rename.sh mars01.local "Living Room"
#   ./rename.sh 192.168.1.50 "Kitchen Display"
#   ./rename.sh mars03 "Bedroom"        # .local is added automatically

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[rename]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <hostname> <new-name>"
    echo ""
    echo "Examples:"
    echo "  $0 mars01.local \"Living Room\""
    echo "  $0 192.168.1.50 \"Kitchen Display\""
    echo "  $0 mars03 \"Bedroom\""
    exit 1
fi

HOST="$1"
NEW_NAME="$2"

# Add .local if hostname doesn't contain a dot (not IP or FQDN)
if [[ ! "$HOST" =~ \. ]]; then
    HOST="${HOST}.local"
fi

INSTALL_DIR="/home/pi/chiba"
DB_PATH="${INSTALL_DIR}/data/node.db"
SSH_USER="pi"

log "Renaming node ${HOST} to \"${NEW_NAME}\"..."

# Check connectivity
if ! ping -c1 -t2 "$HOST" &>/dev/null; then
    error "Cannot reach ${HOST}. Is the node online?"
fi

# Get current name for confirmation
CURRENT_NAME=$(ssh -o ConnectTimeout=5 "${SSH_USER}@${HOST}" \
    "sqlite3 '${DB_PATH}' \"SELECT value FROM config WHERE key='node.friendly_name';\"" 2>/dev/null || echo "")

if [ -n "$CURRENT_NAME" ]; then
    log "Current name: \"${CURRENT_NAME}\""
fi

# Update the database
ssh -o ConnectTimeout=5 "${SSH_USER}@${HOST}" \
    "sqlite3 '${DB_PATH}' \"INSERT OR REPLACE INTO config (key, value) VALUES ('node.friendly_name', '${NEW_NAME}');\"" \
    || error "Failed to update database"

success "Database updated"

# Restart the service so the new name takes effect
log "Restarting chiba-node service..."
ssh -o ConnectTimeout=5 "${SSH_USER}@${HOST}" \
    "sudo systemctl restart chiba-node" \
    || warn "Failed to restart service (you may need to restart manually)"

success "Node renamed to \"${NEW_NAME}\""

# Verify by checking the node status
sleep 2
NODE_STATUS=$(curl -s --connect-timeout 3 "http://${HOST}:8080/status" 2>/dev/null || echo "")
if [ -n "$NODE_STATUS" ]; then
    VERIFIED_NAME=$(echo "$NODE_STATUS" | grep -o '"nodeName":"[^"]*"' | cut -d'"' -f4)
    if [ "$VERIFIED_NAME" = "$NEW_NAME" ]; then
        success "Verified: node is now \"${VERIFIED_NAME}\""
    else
        warn "Node reports name as \"${VERIFIED_NAME}\" (may need a moment to update)"
    fi
fi
