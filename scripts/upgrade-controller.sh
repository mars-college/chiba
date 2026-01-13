#!/bin/bash
# Upgrade Chiba Controller
# Run this ON the controller machine to upgrade it
#
# Usage:
#   ./scripts/upgrade-controller.sh         # Soft upgrade (default): git pull + rebuild + restart
#   ./scripts/upgrade-controller.sh soft    # Same as above
#   ./scripts/upgrade-controller.sh hard    # Hard upgrade: full reinstall from scratch
#
# Soft upgrade:
#   - Pulls latest code from git
#   - Installs dependencies
#   - Rebuilds packages
#   - Restarts chiba-controller service
#
# Hard upgrade:
#   - Backs up .env and data directory
#   - Removes and re-clones the repository
#   - Reinstalls all dependencies
#   - Restores config files
#   - Full setup like initial install

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

MODE="${1:-soft}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_URL="https://github.com/mars-college/chiba.git"

# Validate mode
case "$MODE" in
    soft|hard)
        ;;
    --clean)
        # Legacy flag support - treat as soft with clean
        MODE="soft"
        CLEAN=true
        ;;
    --backup)
        # Legacy flag support - treat as soft with backup
        MODE="soft"
        BACKUP=true
        ;;
    --help|-h)
        echo "Upgrade Chiba Controller"
        echo ""
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
echo "  Chiba Controller Upgrade ($MODE)"
echo "==========================================="
echo ""

cd "$PROJECT_DIR"

if [ "$MODE" = "soft" ]; then
    # ===== SOFT UPGRADE =====
    log "Starting soft upgrade..."

    # Check for uncommitted changes
    if [ -n "$(git status --porcelain)" ]; then
        warn "You have uncommitted changes. Stashing them..."
        git stash
    fi

    # Pull latest code
    log "Fetching latest code..."
    git fetch origin
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git reset --hard "origin/$CURRENT_BRANCH"
    success "Code updated to $(git rev-parse --short HEAD)"

    # Install dependencies
    log "Installing dependencies..."
    NODE_ENV=development pnpm install
    success "Dependencies installed"

    # Build packages
    log "Building packages..."
    NODE_ENV=development pnpm build
    success "Build complete"

    # Regenerate chiba-controller.service (in case service definition changed)
    log "Updating chiba-controller service file..."
    CURRENT_USER=$(stat -c '%U' "$PROJECT_DIR" 2>/dev/null || ls -ld "$PROJECT_DIR" | awk '{print $3}')
    sudo tee /etc/systemd/system/chiba-controller.service > /dev/null << SERVICE_EOF
[Unit]
Description=Chiba Controller Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR/packages/controller
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE_EOF
    success "Service file updated"

    # Restart service if running
    log "Restarting chiba-controller service..."
    sudo systemctl daemon-reload
    if systemctl is-enabled --quiet chiba-controller 2>/dev/null; then
        sudo systemctl restart chiba-controller
        success "Controller service restarted"
    else
        sudo systemctl enable chiba-controller
        sudo systemctl start chiba-controller
        success "Controller service enabled and started"
    fi

else
    # ===== HARD UPGRADE =====
    log "Starting hard upgrade (full reinstall)..."
    warn "This will reinstall everything from scratch"
    echo ""

    # Backup configuration
    log "Backing up configuration..."
    BACKUP_DIR="/tmp/chiba-controller-backup-$$"
    mkdir -p "$BACKUP_DIR"

    # Save .env
    if [ -f "$PROJECT_DIR/.env" ]; then
        cp "$PROJECT_DIR/.env" "$BACKUP_DIR/.env"
        success "Backed up .env"
    fi

    # Save data directory (SQLite databases, etc)
    if [ -d "$PROJECT_DIR/data" ]; then
        cp -r "$PROJECT_DIR/data" "$BACKUP_DIR/data"
        success "Backed up data directory"
    fi

    # Save media directory info (just list, not files - they can be re-downloaded)
    if [ -d "$PROJECT_DIR/media" ]; then
        ls -la "$PROJECT_DIR/media" > "$BACKUP_DIR/media-listing.txt" 2>/dev/null || true
        success "Recorded media directory listing"
    fi

    # Stop service
    log "Stopping chiba-controller service..."
    sudo systemctl stop chiba-controller 2>/dev/null || true

    # Remove old installation
    log "Removing old installation..."
    cd "$HOME" || cd /tmp
    rm -rf "$PROJECT_DIR"
    success "Old installation removed"

    # Clone fresh
    log "Cloning fresh repository..."
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    success "Repository cloned"

    # Create directories
    mkdir -p "$PROJECT_DIR/media"
    mkdir -p "$PROJECT_DIR/data"

    # Restore configuration
    log "Restoring configuration..."
    if [ -f "$BACKUP_DIR/.env" ]; then
        cp "$BACKUP_DIR/.env" "$PROJECT_DIR/.env"
        chmod 600 "$PROJECT_DIR/.env"
        success "Restored .env"
    fi

    if [ -d "$BACKUP_DIR/data" ]; then
        cp -r "$BACKUP_DIR/data"/* "$PROJECT_DIR/data/" 2>/dev/null || true
        success "Restored data directory"
    fi

    # Install dependencies
    log "Installing dependencies..."
    NODE_ENV=development pnpm install
    success "Dependencies installed"

    # Build packages
    log "Building packages..."
    NODE_ENV=development pnpm build
    success "Build complete"

    # Update scripts permissions
    chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

    # Regenerate chiba-controller.service (in case service definition changed)
    log "Updating chiba-controller service file..."
    CURRENT_USER=$(stat -c '%U' "$PROJECT_DIR" 2>/dev/null || ls -ld "$PROJECT_DIR" | awk '{print $3}')
    sudo tee /etc/systemd/system/chiba-controller.service > /dev/null << SERVICE_EOF
[Unit]
Description=Chiba Controller Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR/packages/controller
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE_EOF
    success "Service file updated"

    # Reload and restart service
    log "Restarting services..."
    sudo systemctl daemon-reload
    if systemctl is-enabled --quiet chiba-controller 2>/dev/null; then
        sudo systemctl restart chiba-controller
        success "Controller service restarted"
    else
        sudo systemctl enable chiba-controller
        sudo systemctl start chiba-controller
        success "Controller service enabled and started"
    fi

    # Clean up backup
    rm -rf "$BACKUP_DIR"

    # Verify service is running
    sleep 2
    if systemctl is-active --quiet chiba-controller 2>/dev/null; then
        success "chiba-controller service is running"
    else
        warn "Service may not be running. Check: journalctl -u chiba-controller -n 50"
    fi
fi

echo ""
echo "==========================================="
echo "  Upgrade Complete!"
echo "==========================================="
echo ""
echo "Version: $(git rev-parse --short HEAD)"
if systemctl is-active --quiet chiba-controller 2>/dev/null; then
    echo "Service: $(systemctl is-active chiba-controller)"
fi
echo ""
