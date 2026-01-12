#!/bin/bash
# Rotate a Chiba node's display
#
# Usage:
#   ./rotate.sh <hostname> <rotation>
#
# Rotation values:
#   0   - No rotation (landscape)
#   90  - 90 degrees clockwise (portrait)
#   180 - 180 degrees (upside down)
#   270 - 270 degrees clockwise (portrait, other way)
#
# Examples:
#   ./rotate.sh mars01.local 90
#   ./rotate.sh 192.168.1.50 180
#   ./rotate.sh mars03 0           # .local is added automatically

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[rotate]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <hostname> <rotation>"
    echo ""
    echo "Rotation values:"
    echo "  0   - No rotation (landscape)"
    echo "  90  - 90 degrees clockwise (portrait)"
    echo "  180 - 180 degrees (upside down)"
    echo "  270 - 270 degrees clockwise (portrait, other way)"
    echo ""
    echo "Examples:"
    echo "  $0 mars01.local 90"
    echo "  $0 192.168.1.50 180"
    echo "  $0 mars03 0"
    exit 1
fi

HOST="$1"
ROTATION="$2"
PORT="${CHIBA_PORT:-8080}"

# Validate rotation
case "$ROTATION" in
    0|90|180|270)
        ;;
    *)
        error "Invalid rotation: $ROTATION. Must be 0, 90, 180, or 270"
        ;;
esac

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

log "Rotating display on ${HOST} to ${ROTATION} degrees..."

# Check connectivity by getting current status
NODE_URL="http://${HOST}:${PORT}"
CURRENT_STATUS=$(curl -s --connect-timeout 5 "${NODE_URL}/status" 2>/dev/null || echo "")

if [ -z "$CURRENT_STATUS" ]; then
    error "Cannot reach ${HOST}:${PORT}. Is the node online?"
fi

# Extract current rotation from status response (if available)
CURRENT_ROTATION=$(echo "$CURRENT_STATUS" | grep -o '"displayRotation":[0-9]*' | cut -d':' -f2)
if [ -n "$CURRENT_ROTATION" ]; then
    log "Current rotation: ${CURRENT_ROTATION} degrees"
fi

# Call the rotate API endpoint
AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
    AUTH_HEADER="-H \"Authorization: Bearer ${API_KEY}\""
fi

# Build the curl command
RESPONSE=$(eval curl -s --connect-timeout 5 -X POST \
    "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "{\"rotation\": ${ROTATION}}" \
    "${NODE_URL}/rotate" 2>/dev/null || echo "")

if [ -z "$RESPONSE" ]; then
    error "No response from node API"
fi

# Check for success
if echo "$RESPONSE" | grep -q '"success":true'; then
    success "Display rotated to ${ROTATION} degrees"
    log "Dashboard will update automatically"
    log "Rotation persists after reboot"
else
    # Extract error message
    ERROR_MSG=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$ERROR_MSG" ]; then
        error "Failed to rotate: ${ERROR_MSG}"
    else
        error "Failed to rotate display. Response: ${RESPONSE}"
    fi
fi
