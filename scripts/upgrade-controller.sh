#!/bin/bash
# Upgrade Chiba Controller
# Run this ON the controller machine to upgrade it
#
# Usage:
#   ./scripts/upgrade-controller.sh
#   ./scripts/upgrade-controller.sh --clean    # Also remove node_modules
#   ./scripts/upgrade-controller.sh --backup   # Backup data before upgrade

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Parse arguments
CLEAN=false
BACKUP=false

while [ $# -gt 0 ]; do
    case $1 in
        --clean)
            CLEAN=true
            shift
            ;;
        --backup)
            BACKUP=true
            shift
            ;;
        --help|-h)
            echo "Upgrade Chiba Controller"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --clean     Remove node_modules before install"
            echo "  --backup    Backup data directory before upgrade"
            echo ""
            echo "Run this script ON the controller machine."
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "==========================================="
echo "  Chiba Controller Upgrade"
echo "==========================================="
echo ""

cd "$PROJECT_DIR"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    warn "You have uncommitted changes. Stashing them..."
    git stash
fi

# Backup data if requested
if [ "$BACKUP" = true ]; then
    log "Creating backup..."
    BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    [ -d "$PROJECT_DIR/data" ] && cp -r "$PROJECT_DIR/data" "$BACKUP_DIR/"
    [ -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env" "$BACKUP_DIR/"
    success "Backup created: $BACKUP_DIR"
fi

# Pull latest code
log "Fetching latest code..."
git fetch origin
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git reset --hard "origin/$CURRENT_BRANCH"
success "Code updated to $(git rev-parse --short HEAD)"

# Clean if requested
if [ "$CLEAN" = true ]; then
    log "Cleaning node_modules..."
    rm -rf node_modules packages/*/node_modules
    success "Clean complete"
fi

# Install dependencies
log "Installing dependencies..."
NODE_ENV=development pnpm install
success "Dependencies installed"

# Build packages
log "Building packages..."
NODE_ENV=development pnpm build
success "Build complete"

# Restart service if running
log "Checking for running service..."
if systemctl is-active --quiet chiba-controller 2>/dev/null; then
    sudo systemctl daemon-reload
    sudo systemctl restart chiba-controller
    success "Controller service restarted"
else
    warn "No systemd service running. Start manually if needed."
fi

echo ""
echo "==========================================="
echo "  Upgrade Complete!"
echo "==========================================="
echo ""
echo "Version: $(git rev-parse --short HEAD)"
echo ""
