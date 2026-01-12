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
PORT="${CHIBA_PORT:-8080}"

# Add .local if hostname doesn't contain a dot (not IP or FQDN)
if [[ ! "$HOST" =~ \. ]]; then
    HOST="${HOST}.local"
fi

# Load API key from .env if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
    API_KEY=$(grep -E '^API_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

# Allow override via environment
API_KEY="${CHIBA_API_KEY:-$API_KEY}"

if [ -z "$API_KEY" ]; then
    warn "No API_KEY found. Set CHIBA_API_KEY or add to .env file."
    warn "Trying without authentication (will fail if node requires auth)..."
fi

log "Renaming node ${HOST} to \"${NEW_NAME}\"..."

# Check connectivity by getting current status
NODE_URL="http://${HOST}:${PORT}"
CURRENT_STATUS=$(curl -s --connect-timeout 5 "${NODE_URL}/status" 2>/dev/null || echo "")

if [ -z "$CURRENT_STATUS" ]; then
    error "Cannot reach ${HOST}:${PORT}. Is the node online?"
fi

# Extract current name from status response
CURRENT_NAME=$(echo "$CURRENT_STATUS" | grep -o '"friendlyName":"[^"]*"' | cut -d'"' -f4)
if [ -n "$CURRENT_NAME" ]; then
    log "Current name: \"${CURRENT_NAME}\""
fi

# Call the rename API endpoint
AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
    AUTH_HEADER="-H \"Authorization: Bearer ${API_KEY}\""
fi

# Build the curl command
RESPONSE=$(eval curl -s --connect-timeout 5 -X POST \
    "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${NEW_NAME}\"}" \
    "${NODE_URL}/rename" 2>/dev/null || echo "")

if [ -z "$RESPONSE" ]; then
    error "No response from node API"
fi

# Check for success
if echo "$RESPONSE" | grep -q '"success":true'; then
    success "Node renamed to \"${NEW_NAME}\""

    # The dashboard should update automatically via WebSocket
    log "Dashboard will update automatically"
else
    # Extract error message
    ERROR_MSG=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$ERROR_MSG" ]; then
        error "Failed to rename: ${ERROR_MSG}"
    else
        error "Failed to rename node. Response: ${RESPONSE}"
    fi
fi

# Verify by checking the node status
sleep 1
VERIFY_STATUS=$(curl -s --connect-timeout 3 "${NODE_URL}/status" 2>/dev/null || echo "")
if [ -n "$VERIFY_STATUS" ]; then
    VERIFIED_NAME=$(echo "$VERIFY_STATUS" | grep -o '"friendlyName":"[^"]*"' | cut -d'"' -f4)
    if [ "$VERIFIED_NAME" = "$NEW_NAME" ]; then
        success "Verified: node is now \"${VERIFIED_NAME}\""
    else
        warn "Node reports name as \"${VERIFIED_NAME}\" (expected \"${NEW_NAME}\")"
    fi
fi
