#!/bin/bash
# Chiba Node Upgrade Script
# Run this on a Pi node to upgrade it
#
# Usage:
#   ./upgrade-node.sh         # Soft upgrade (default): git pull + rebuild + restart
#   ./upgrade-node.sh soft    # Same as above
#   ./upgrade-node.sh hard    # Hard upgrade: full reinstall from scratch
#
# Soft upgrade:
#   - Pulls latest code from git
#   - Installs dependencies
#   - Rebuilds packages
#   - Restarts chiba-node service
#
# Hard upgrade:
#   - Backs up .env and config files
#   - Removes and re-clones the repository
#   - Reinstalls all system packages
#   - Restores config files
#   - Full setup like initial install

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MODE="${1:-soft}"
INSTALL_DIR="/home/pi/chiba"
REPO_URL="https://github.com/mars-college/chiba.git"

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Validate mode
case "$MODE" in
    soft|hard)
        ;;
    --help|-h)
        echo "Usage: $0 [soft|hard]"
        echo ""
        echo "Modes:"
        echo "  soft    (default) Git pull + rebuild + restart service"
        echo "  hard    Full reinstall from scratch (preserves config)"
        echo ""
        echo "Examples:"
        echo "  $0           # Soft upgrade"
        echo "  $0 soft      # Soft upgrade"
        echo "  $0 hard      # Hard upgrade (reinstall everything)"
        exit 0
        ;;
    *)
        error "Unknown mode: $MODE (use 'soft' or 'hard')"
        ;;
esac

echo ""
echo "==========================================="
echo "  Chiba Node Upgrade ($MODE)"
echo "==========================================="
echo ""

# Check we're in the right place
if [ ! -d "$INSTALL_DIR" ]; then
    error "Chiba not found at $INSTALL_DIR. Is this a Chiba node?"
fi

cd "$INSTALL_DIR"

if [ "$MODE" = "soft" ]; then
    # ===== SOFT UPGRADE =====
    log "Starting soft upgrade..."

    # Check for local changes
    if [ -n "$(git status --porcelain)" ]; then
        warn "Local changes detected. Stashing..."
        git stash
    fi

    # Pull latest code
    log "Fetching latest code..."
    git fetch origin
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git reset --hard "origin/$CURRENT_BRANCH"
    success "Code updated to $(git rev-parse --short HEAD)"

    # Install dependencies (force dev deps even if NODE_ENV=production)
    log "Installing dependencies..."
    NODE_ENV=development pnpm install
    success "Dependencies installed"

    # Build packages
    log "Building packages..."
    NODE_ENV=development pnpm build
    success "Build complete"

    # Restart service
    log "Restarting chiba-node service..."
    sudo systemctl daemon-reload
    sudo systemctl restart chiba-node
    success "Service restarted"

    # Verify service is running
    sleep 2
    if systemctl is-active --quiet chiba-node; then
        success "chiba-node service is running"
    else
        warn "Service may have failed to start. Check: journalctl -u chiba-node -n 50"
    fi

else
    # ===== HARD UPGRADE =====
    log "Starting hard upgrade (full reinstall)..."
    warn "This will reinstall everything from scratch"
    echo ""

    # Backup configuration
    log "Backing up configuration..."
    BACKUP_DIR="/tmp/chiba-upgrade-backup-$$"
    mkdir -p "$BACKUP_DIR"

    # Save .env
    if [ -f "$INSTALL_DIR/.env" ]; then
        cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
        success "Backed up .env"
    fi

    # Save display rotation config
    if [ -f "$INSTALL_DIR/.display-rotate" ]; then
        cp "$INSTALL_DIR/.display-rotate" "$BACKUP_DIR/.display-rotate"
        success "Backed up display rotation setting"
    fi

    # Save any SQLite databases (preserve history/cache metadata)
    if [ -d "$INSTALL_DIR/data" ]; then
        cp -r "$INSTALL_DIR/data" "$BACKUP_DIR/data"
        success "Backed up data directory"
    fi

    # Extract config from .env for reinstall
    if [ -f "$BACKUP_DIR/.env" ]; then
        source "$BACKUP_DIR/.env"
    fi

    # Stop service
    log "Stopping chiba-node service..."
    sudo systemctl stop chiba-node 2>/dev/null || true

    # Remove old installation
    log "Removing old installation..."
    rm -rf "$INSTALL_DIR"
    success "Old installation removed"

    # Clone fresh
    log "Cloning fresh repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    success "Repository cloned"

    # Create directories
    mkdir -p "$INSTALL_DIR/media"
    mkdir -p "$INSTALL_DIR/data"

    # Restore configuration
    log "Restoring configuration..."
    if [ -f "$BACKUP_DIR/.env" ]; then
        cp "$BACKUP_DIR/.env" "$INSTALL_DIR/.env"
        chmod 600 "$INSTALL_DIR/.env"
        success "Restored .env"
    fi

    if [ -f "$BACKUP_DIR/.display-rotate" ]; then
        cp "$BACKUP_DIR/.display-rotate" "$INSTALL_DIR/.display-rotate"
        success "Restored display rotation setting"
    fi

    if [ -d "$BACKUP_DIR/data" ]; then
        cp -r "$BACKUP_DIR/data"/* "$INSTALL_DIR/data/" 2>/dev/null || true
        success "Restored data directory"
    fi

    # Update system packages
    log "Updating system packages..."
    sudo apt update
    sudo apt upgrade -y
    success "System packages updated"

    # Ensure Node.js 20+
    NODE_MAJOR=$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo "0")
    if [ "$NODE_MAJOR" -lt 20 ]; then
        log "Upgrading Node.js to 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt install -y nodejs
        success "Node.js upgraded to $(node -v)"
    fi

    # Ensure pnpm 9+
    PNPM_MAJOR=$(pnpm -v 2>/dev/null | cut -d. -f1 || echo "0")
    if [ "$PNPM_MAJOR" -lt 9 ]; then
        log "Upgrading pnpm to 9..."
        sudo npm install -g pnpm@9
        success "pnpm upgraded to $(pnpm -v)"
    fi

    # Update yt-dlp
    log "Updating yt-dlp..."
    sudo pip3 install --break-system-packages --upgrade yt-dlp 2>/dev/null || \
        sudo pip3 install --upgrade yt-dlp || true
    success "yt-dlp updated"

    # Install dependencies (force dev deps even if NODE_ENV=production)
    log "Installing dependencies..."
    NODE_ENV=development pnpm install
    success "Dependencies installed"

    # Build packages
    log "Building packages..."
    NODE_ENV=development pnpm build
    success "Build complete"

    # Recreate run-kiosk.sh (in case it changed)
    log "Updating kiosk script..."
    chmod +x "$INSTALL_DIR/scripts/run-kiosk.sh" 2>/dev/null || true
    chmod +x "$INSTALL_DIR/scripts/rotate-display.sh" 2>/dev/null || true

    # Reload and restart service
    log "Restarting services..."
    sudo systemctl daemon-reload
    sudo systemctl restart chiba-node
    success "Service restarted"

    # Clean up backup
    rm -rf "$BACKUP_DIR"

    # Verify service is running
    sleep 2
    if systemctl is-active --quiet chiba-node; then
        success "chiba-node service is running"
    else
        warn "Service may have failed to start. Check: journalctl -u chiba-node -n 50"
    fi
fi

echo ""
echo "==========================================="
echo "  Upgrade Complete!"
echo "==========================================="
echo ""
echo "Current version: $(git rev-parse --short HEAD)"
echo "Service status:  $(systemctl is-active chiba-node 2>/dev/null || echo 'unknown')"
echo ""
echo "To view logs:    journalctl -u chiba-node -f"
echo "To check status: curl -s http://localhost:8080/health"
echo ""
