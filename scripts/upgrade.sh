#!/bin/bash
# Chiba Upgrade Script
# Upgrades controller or node installations with breaking change handling
#
# Usage:
#   ./scripts/upgrade.sh               # Upgrade local installation
#   ./scripts/upgrade.sh --controller  # Upgrade controller (same as above)
#   ./scripts/upgrade.sh --node pi@hostname  # Upgrade remote Pi node
#   ./scripts/upgrade.sh --all-nodes   # Upgrade all nodes (reads from .env)
#
# Options:
#   --no-restart    Don't restart services after upgrade
#   --backup        Create backup of data directory before upgrade
#   --clean         Clean install (remove node_modules)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
MODE="controller"
REMOTE_HOST=""
NO_RESTART=false
BACKUP=false
CLEAN=false

while [ $# -gt 0 ]; do
    case $1 in
        --controller)
            MODE="controller"
            shift
            ;;
        --node)
            MODE="node"
            REMOTE_HOST="$2"
            shift 2
            ;;
        --all-nodes)
            MODE="all-nodes"
            shift
            ;;
        --no-restart)
            NO_RESTART=true
            shift
            ;;
        --backup)
            BACKUP=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --controller        Upgrade local controller installation"
            echo "  --node HOST         Upgrade remote node (e.g., pi@10.10.13.9)"
            echo "  --all-nodes         Upgrade all known nodes from .env"
            echo "  --no-restart        Don't restart services after upgrade"
            echo "  --backup            Create backup of data directory"
            echo "  --clean             Remove node_modules before install"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log() {
    echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

upgrade_local() {
    log "Upgrading local Chiba installation..."

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
    log "Pulling latest code from git..."
    git fetch origin
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git pull origin "$CURRENT_BRANCH"
    success "Code updated"

    # Clean if requested
    if [ "$CLEAN" = true ]; then
        log "Cleaning node_modules..."
        rm -rf node_modules packages/*/node_modules
        success "Clean complete"
    fi

    # Install dependencies
    log "Installing dependencies..."
    pnpm install
    success "Dependencies installed"

    # Build packages
    log "Building packages..."
    pnpm build
    success "Build complete"

    # Handle database migrations (future-proofing)
    if [ -f "$PROJECT_DIR/scripts/migrate.js" ]; then
        log "Running database migrations..."
        node "$PROJECT_DIR/scripts/migrate.js"
        success "Migrations complete"
    fi

    # Restart services
    if [ "$NO_RESTART" = false ]; then
        log "Checking for running services..."

        # Check if controller is running via systemd
        if systemctl is-active --quiet chiba-controller 2>/dev/null; then
            log "Restarting chiba-controller service..."
            sudo systemctl restart chiba-controller
            success "Controller service restarted"
        elif systemctl is-active --quiet chiba-node 2>/dev/null; then
            log "Restarting chiba-node service..."
            sudo systemctl restart chiba-node
            success "Node service restarted"
        else
            warn "No systemd service found. You may need to manually restart the server."
        fi
    fi

    success "Local upgrade complete!"
}

upgrade_remote_node() {
    local HOST="$1"
    log "Upgrading remote node: $HOST"

    # Check SSH connectivity
    if ! ssh -o ConnectTimeout=5 "$HOST" "echo connected" >/dev/null 2>&1; then
        error "Cannot connect to $HOST"
        return 1
    fi

    # Create upgrade script to run on remote
    local UPGRADE_SCRIPT='
    set -e
    cd /home/pi/chiba

    echo "[Upgrade] Fetching latest code..."
    git fetch origin
    git reset --hard origin/main

    echo "[Upgrade] Installing dependencies..."
    pnpm install

    echo "[Upgrade] Building..."
    pnpm build

    echo "[Upgrade] Restarting service..."
    sudo systemctl restart chiba-node || true

    echo "[Upgrade] Done!"
    '

    ssh "$HOST" "$UPGRADE_SCRIPT"
    success "Remote node $HOST upgraded"
}

# Main execution
case $MODE in
    controller)
        upgrade_local
        ;;
    node)
        if [ -z "$REMOTE_HOST" ]; then
            error "No remote host specified"
            exit 1
        fi
        upgrade_remote_node "$REMOTE_HOST"
        ;;
    all-nodes)
        log "Upgrading all nodes..."

        # First upgrade local controller
        upgrade_local

        # Read node hosts from environment or discover
        if [ -f "$PROJECT_DIR/.env" ]; then
            source "$PROJECT_DIR/.env"
        fi

        # Try to get nodes from controller API
        CONTROLLER_URL="${CONTROLLER_URL:-http://localhost:8080}"
        NODES=$(curl -s "$CONTROLLER_URL/api/nodes" 2>/dev/null | grep -oP '"ip":"[^"]+' | cut -d'"' -f4 || echo "")

        if [ -n "$NODES" ]; then
            for IP in $NODES; do
                if [ "$IP" != "127.0.0.1" ] && [ "$IP" != "localhost" ]; then
                    log "Found node at $IP"
                    upgrade_remote_node "pi@$IP" || warn "Failed to upgrade $IP"
                fi
            done
        else
            warn "No remote nodes found. Run with --node pi@hostname to upgrade specific nodes."
        fi

        success "All upgrades complete!"
        ;;
esac

echo ""
log "Upgrade finished at $(date)"
