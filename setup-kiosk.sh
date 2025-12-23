#!/bin/bash
# Raspberry Pi Kiosk Setup Script
# Run on a fresh Raspberry Pi OS 64-bit install
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh | bash
#
# Or manually:
#   wget https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh
#   chmod +x setup-kiosk.sh && ./setup-kiosk.sh

set -e

INSTALL_DIR="/home/pi"
REPO_URL="https://github.com/mars-college/chiba.git"

echo "==========================================="
echo "  Raspberry Pi Kiosk Setup"
echo "==========================================="
echo ""
echo "Install directory: $INSTALL_DIR"
echo "Repository: $REPO_URL"
echo ""

# Check if running as pi user
if [ "$(whoami)" != "pi" ]; then
    echo "Warning: This script is designed to run as 'pi' user"
    echo "Current user: $(whoami)"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "=== Updating system ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing required packages ==="
sudo apt install -y \
    git \
    cage \
    chromium \
    nodejs \
    npm

echo "=== Cleaning up old installation ==="
# Remove old files from previous setup (when files were in /home/pi/ directly)
rm -f "$INSTALL_DIR/server.js" 2>/dev/null || true
rm -f "$INSTALL_DIR/run_kiosk.sh" 2>/dev/null || true
rm -f "$INSTALL_DIR/kiosk-server.sh" 2>/dev/null || true
rm -f "$INSTALL_DIR/kiosk.service" 2>/dev/null || true
rm -f "$INSTALL_DIR/setup-kiosk.sh" 2>/dev/null || true
rm -f "$INSTALL_DIR/package.json" 2>/dev/null || true
rm -f "$INSTALL_DIR/package-lock.json" 2>/dev/null || true
rm -rf "$INSTALL_DIR/public" 2>/dev/null || true
rm -rf "$INSTALL_DIR/node_modules" 2>/dev/null || true

echo "=== Cloning repository ==="
cd "$INSTALL_DIR"

# Clone or update the repo
if [ -d "$INSTALL_DIR/chiba" ]; then
    echo "Repository exists, pulling latest..."
    cd "$INSTALL_DIR/chiba"
    git pull
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR/chiba"
    cd "$INSTALL_DIR/chiba"
fi

echo "=== Setting up directories ==="
mkdir -p "$INSTALL_DIR/chiba/media"

# Make scripts executable
chmod +x "$INSTALL_DIR/chiba/run_kiosk.sh"
chmod +x "$INSTALL_DIR/chiba/kiosk-server.sh"

echo "=== Installing Node.js dependencies ==="
cd "$INSTALL_DIR/chiba"
npm install ws

echo "=== Setting environment variables ==="
# Add to /etc/environment for system-wide availability
sudo grep -q "NODE_ENV=production" /etc/environment || \
    echo "NODE_ENV=production" | sudo tee -a /etc/environment

# Add to user profile for interactive sessions
grep -q "export NODE_ENV=production" ~/.profile || \
    echo "export NODE_ENV=production" >> ~/.profile

grep -q "export XDG_RUNTIME_DIR=/run/user/1000" ~/.profile || \
    echo "export XDG_RUNTIME_DIR=/run/user/1000" >> ~/.profile

echo "=== Disabling screen blanking ==="

# Create screen blanking disable service
sudo tee /etc/systemd/system/disable-blanking.service > /dev/null << 'EOF'
[Unit]
Description=Disable screen blanking
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "echo 0 > /sys/class/graphics/fb0/blank || true"
ExecStart=/usr/bin/setterm --blank 0 --powerdown 0 --powersave off
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# Disable console blanking in kernel cmdline
CMDLINE_FILE=""
if [ -f /boot/firmware/cmdline.txt ]; then
    CMDLINE_FILE="/boot/firmware/cmdline.txt"
elif [ -f /boot/cmdline.txt ]; then
    CMDLINE_FILE="/boot/cmdline.txt"
fi

if [ -n "$CMDLINE_FILE" ]; then
    if ! grep -q "consoleblank=0" "$CMDLINE_FILE"; then
        sudo sed -i 's/$/ consoleblank=0/' "$CMDLINE_FILE"
        echo "Added consoleblank=0 to $CMDLINE_FILE"
    fi
fi

echo "=== Configuring boot options ==="

# Set boot to console autologin (no desktop)
sudo raspi-config nonint do_boot_behaviour B2

# Disable desktop environment
sudo systemctl set-default multi-user.target
sudo systemctl disable lightdm 2>/dev/null || true
sudo systemctl disable gdm3 2>/dev/null || true

echo "=== Removing old systemd kiosk service ==="
sudo systemctl stop kiosk 2>/dev/null || true
sudo systemctl disable kiosk 2>/dev/null || true
sudo rm -f /etc/systemd/system/kiosk.service

echo "=== Enabling screen blanking service ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking

echo "=== Setting up auto-start on login ==="
# The kiosk starts via .bash_profile when pi user logs in on TTY1
# This works with the console autologin we configured earlier

# Remove old entries if they exist
sed -i '/# Kiosk auto-start/d' ~/.bash_profile 2>/dev/null || true
sed -i '/run_kiosk.sh/d' ~/.bash_profile 2>/dev/null || true

# Add kiosk auto-start to .bash_profile
cat >> ~/.bash_profile << 'EOF'

# Kiosk auto-start (only on TTY1 with display)
if [ "$(tty)" = "/dev/tty1" ]; then
    cd ~/chiba && ./run_kiosk.sh
fi
EOF

echo "  Added kiosk auto-start to ~/.bash_profile"
echo "  Kiosk will start automatically when pi user logs in on TTY1"

echo "=== Verifying installation ==="
echo ""
echo "Checking installed files..."
[ -f "$INSTALL_DIR/chiba/server.js" ] && echo "  ✓ server.js" || echo "  ✗ server.js MISSING"
[ -f "$INSTALL_DIR/chiba/run_kiosk.sh" ] && echo "  ✓ run_kiosk.sh" || echo "  ✗ run_kiosk.sh MISSING"
[ -f "$INSTALL_DIR/chiba/public/index.html" ] && echo "  ✓ public/index.html" || echo "  ✗ public/index.html MISSING"
[ -d "$INSTALL_DIR/chiba/node_modules/ws" ] && echo "  ✓ node_modules/ws" || echo "  ✗ node_modules/ws MISSING"

echo ""
echo "Checking configuration..."
systemctl is-enabled disable-blanking &>/dev/null && echo "  ✓ screen blanking disabled" || echo "  ✗ screen blanking service NOT enabled"
grep -q "run_kiosk.sh" ~/.bash_profile && echo "  ✓ kiosk auto-start configured" || echo "  ✗ kiosk auto-start NOT configured"

echo ""
echo "Note: The kiosk starts on boot via autologin to TTY1."
echo "      To test now: cd ~/chiba && node server.js"

PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "The kiosk will auto-start on boot when a display is connected."
echo ""
echo "Add videos:"
echo "  scp your-video.mp4 pi@$PI_IP:/home/pi/chiba/media/"
echo ""
echo "API (after reboot):"
echo "  curl http://$PI_IP:8080/status"
echo "  curl http://$PI_IP:8080/files"
echo "  curl -X POST http://$PI_IP:8080/file -H 'Content-Type: application/json' -d '{\"file\":\"example.mp4\"}'"
echo "  curl -X POST http://$PI_IP:8080/off"
echo ""
echo "Player: http://$PI_IP:8080/player"
echo ""
echo "To stop kiosk: Switch to TTY2 with Ctrl+Alt+F2, login, then: pkill -f run_kiosk"
echo "To restart:    sudo reboot"
echo ""

read -p "Reboot now to start kiosk? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Reboot when ready: sudo reboot"
else
    sudo reboot
fi
