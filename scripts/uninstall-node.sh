#!/bin/bash
# Chiba Node Uninstall Script
# Completely removes Chiba from a Raspberry Pi node
#
# Usage:
#   ./uninstall-node.sh              # Interactive (asks for confirmation)
#   ./uninstall-node.sh --autoconfirm  # Non-interactive (no confirmation)
#
# This script will:
#   - Stop and disable all Chiba services
#   - Remove systemd service files
#   - Remove the Chiba installation directory
#   - Clean up user configuration files
#   - Optionally remove installed dependencies
#   - Self-delete

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
AUTOCONFIRM=false
REMOVE_DEPS=false

while [ $# -gt 0 ]; do
    case $1 in
        --autoconfirm|-y)
            AUTOCONFIRM=true
            shift
            ;;
        --remove-deps)
            REMOVE_DEPS=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --autoconfirm, -y   Skip confirmation prompt"
            echo "  --remove-deps       Also remove yt-dlp and gdown (not Node.js/pnpm)"
            echo "  --help, -h          Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Detect installation directory
INSTALL_DIR="/home/pi/chiba"
if [ -d "/home/$(whoami)/chiba" ]; then
    INSTALL_DIR="/home/$(whoami)/chiba"
fi

# Get script's own path before we delete things
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

echo ""
echo -e "${RED}==========================================="
echo "  Chiba Node Uninstall"
echo -e "===========================================${NC}"
echo ""
echo "This will completely remove Chiba from this system:"
echo ""
echo "  Services to stop/remove:"
echo "    - chiba-node.service"
echo "    - chiba-network-watchdog.service"
echo "    - disable-blanking.service"
echo ""
echo "  Files/directories to remove:"
echo "    - $INSTALL_DIR (installation directory)"
echo "    - /etc/systemd/system/chiba-*.service"
echo "    - /etc/systemd/system/disable-blanking.service"
echo "    - ~/.bash_profile (kiosk auto-start)"
echo "    - ~/.asoundrc (audio config)"
echo ""
if [ "$REMOVE_DEPS" = true ]; then
    echo "  Dependencies to remove (--remove-deps):"
    echo "    - yt-dlp"
    echo "    - gdown"
    echo ""
fi
echo -e "${YELLOW}WARNING: This action cannot be undone!${NC}"
echo ""

# Confirmation
if [ "$AUTOCONFIRM" = false ]; then
    read -p "Are you sure you want to uninstall Chiba? (y/N) " -n 1 -r </dev/tty
    echo
    case "$REPLY" in
        [Yy]*)
            echo "Proceeding with uninstall..."
            ;;
        *)
            echo "Uninstall cancelled."
            exit 0
            ;;
    esac
else
    echo "Auto-confirm enabled, proceeding with uninstall..."
fi

echo ""

# Stop and disable services
echo "=== Stopping services ==="
for service in chiba-node chiba-kiosk chiba-network-watchdog disable-blanking; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        echo "Stopping $service..."
        sudo systemctl stop "$service" 2>/dev/null || true
    fi
    if systemctl is-enabled --quiet "$service" 2>/dev/null; then
        echo "Disabling $service..."
        sudo systemctl disable "$service" 2>/dev/null || true
    fi
done

# Kill any running kiosk processes
echo "=== Stopping kiosk processes ==="
pkill -9 cage 2>/dev/null || true
pkill -9 -f "chromium.*localhost:8080" 2>/dev/null || true

# Remove systemd service files
echo "=== Removing systemd service files ==="
for service_file in /etc/systemd/system/chiba-node.service \
                    /etc/systemd/system/chiba-kiosk.service \
                    /etc/systemd/system/chiba-network-watchdog.service \
                    /etc/systemd/system/disable-blanking.service; do
    if [ -f "$service_file" ]; then
        echo "Removing $service_file..."
        sudo rm -f "$service_file"
    fi
done
sudo systemctl daemon-reload

# Remove installation directory
echo "=== Removing installation directory ==="
if [ -d "$INSTALL_DIR" ]; then
    echo "Removing $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
else
    echo "Installation directory not found: $INSTALL_DIR"
fi

# Clean up user configuration
echo "=== Cleaning up user configuration ==="
HOME_DIR=$(eval echo ~$(whoami))

# Remove kiosk auto-start from .bash_profile
if [ -f "$HOME_DIR/.bash_profile" ]; then
    if grep -q "run-kiosk.sh" "$HOME_DIR/.bash_profile"; then
        echo "Removing kiosk auto-start from .bash_profile..."
        rm -f "$HOME_DIR/.bash_profile"
    fi
fi

# Remove ALSA config
if [ -f "$HOME_DIR/.asoundrc" ]; then
    if grep -q "Chiba" "$HOME_DIR/.asoundrc"; then
        echo "Removing audio configuration..."
        rm -f "$HOME_DIR/.asoundrc"
    fi
fi

# Clean up environment variables
echo "=== Cleaning up environment variables ==="
if [ -f /etc/environment ]; then
    if grep -q "NODE_ENV=production" /etc/environment; then
        echo "Removing NODE_ENV from /etc/environment..."
        sudo sed -i '/NODE_ENV=production/d' /etc/environment
    fi
fi

if [ -f "$HOME_DIR/.profile" ]; then
    if grep -q "NODE_ENV=production" "$HOME_DIR/.profile"; then
        echo "Removing NODE_ENV from .profile..."
        sed -i '/export NODE_ENV=production/d' "$HOME_DIR/.profile"
    fi
    if grep -q "XDG_RUNTIME_DIR" "$HOME_DIR/.profile"; then
        sed -i '/export XDG_RUNTIME_DIR/d' "$HOME_DIR/.profile"
    fi
fi

# Clean up kernel cmdline (remove consoleblank=0)
echo "=== Cleaning up boot configuration ==="
CMDLINE_FILE=""
if [ -f /boot/firmware/cmdline.txt ]; then
    CMDLINE_FILE="/boot/firmware/cmdline.txt"
elif [ -f /boot/cmdline.txt ]; then
    CMDLINE_FILE="/boot/cmdline.txt"
fi

if [ -n "$CMDLINE_FILE" ] && grep -q "consoleblank=0" "$CMDLINE_FILE"; then
    echo "Removing consoleblank=0 from $CMDLINE_FILE..."
    sudo sed -i 's/ consoleblank=0//g' "$CMDLINE_FILE"
fi

# Clean up temp files
echo "=== Cleaning up temp files ==="
rm -f /tmp/chiba-exit-kiosk
rm -f /tmp/chiba-rotate-signal

# Remove dependencies if requested
if [ "$REMOVE_DEPS" = true ]; then
    echo "=== Removing optional dependencies ==="
    if command -v pip3 &>/dev/null; then
        echo "Removing yt-dlp..."
        sudo pip3 uninstall -y yt-dlp 2>/dev/null || true
        echo "Removing gdown..."
        sudo pip3 uninstall -y gdown 2>/dev/null || true
    fi
fi

# Re-enable desktop if it was disabled
echo "=== Restoring desktop manager ==="
if systemctl list-unit-files | grep -q "lightdm"; then
    echo "Re-enabling lightdm..."
    sudo systemctl enable lightdm 2>/dev/null || true
fi

# Set default target back to graphical if desktop is available
if systemctl list-unit-files | grep -q "graphical.target"; then
    echo "Setting default target to graphical..."
    sudo systemctl set-default graphical.target 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}==========================================="
echo "  Uninstall Complete!"
echo -e "===========================================${NC}"
echo ""
echo "Chiba has been removed from this system."
echo ""
echo "Note: The following were NOT removed:"
echo "  - Node.js and pnpm (may be used by other software)"
echo "  - System packages (git, chromium, curl, etc.)"
if [ "$REMOVE_DEPS" = false ]; then
    echo "  - yt-dlp and gdown (use --remove-deps to remove)"
fi
echo ""
echo "A reboot is recommended to complete cleanup."
echo ""

# Self-delete
echo "Self-deleting uninstall script..."
rm -f "$SCRIPT_PATH"

echo "Done."
