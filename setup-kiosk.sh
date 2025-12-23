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

echo "=== Creating kiosk systemd service ==="
sudo tee /etc/systemd/system/kiosk.service > /dev/null << EOF
[Unit]
Description=Kiosk Digital Signage
After=network.target
Wants=network-online.target

[Service]
User=pi
Group=pi
PAMName=login
Type=simple

# TTY settings for cage/Wayland
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal

# Environment
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=WLR_LIBINPUT_NO_DEVICES=1
Environment=WLR_NO_HARDWARE_CURSORS=1
Environment=NODE_ENV=production

# Working directory and startup
WorkingDirectory=$INSTALL_DIR/chiba
ExecStart=$INSTALL_DIR/chiba/run_kiosk.sh

# Restart policy
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "=== Stopping old services if running ==="
sudo systemctl stop kiosk 2>/dev/null || true
sudo systemctl disable kiosk 2>/dev/null || true

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking
sudo systemctl enable kiosk

echo "=== Starting kiosk service ==="
sudo systemctl start kiosk

echo "=== Verifying installation ==="
echo ""
echo "Checking installed files..."
[ -f "$INSTALL_DIR/chiba/server.js" ] && echo "  ✓ server.js" || echo "  ✗ server.js MISSING"
[ -f "$INSTALL_DIR/chiba/run_kiosk.sh" ] && echo "  ✓ run_kiosk.sh" || echo "  ✗ run_kiosk.sh MISSING"
[ -f "$INSTALL_DIR/chiba/public/index.html" ] && echo "  ✓ public/index.html" || echo "  ✗ public/index.html MISSING"
[ -d "$INSTALL_DIR/chiba/node_modules/ws" ] && echo "  ✓ node_modules/ws" || echo "  ✗ node_modules/ws MISSING"

echo ""
echo "Checking services..."
systemctl is-enabled kiosk &>/dev/null && echo "  ✓ kiosk service enabled" || echo "  ✗ kiosk service NOT enabled"
systemctl is-enabled disable-blanking &>/dev/null && echo "  ✓ disable-blanking service enabled" || echo "  ✗ disable-blanking service NOT enabled"

echo ""
echo "Checking service status..."
sleep 3  # Give service time to start
if systemctl is-active kiosk &>/dev/null; then
    echo "  ✓ kiosk service is running"

    # Check if server is responding
    sleep 2
    if curl -s http://localhost:8080/status &>/dev/null; then
        echo "  ✓ server responding on port 8080"
    else
        echo "  ⚠ server not responding yet (may need a moment)"
    fi
else
    echo "  ⚠ kiosk service not running (normal if no display connected via SSH)"
    echo ""
    echo "  The service will start automatically on reboot with a display."
    echo "  To test the server manually: cd ~/chiba && node server.js"
fi

PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "The kiosk will auto-start on boot with a display connected."
echo ""
echo "Add videos:"
echo "  scp your-video.mp4 pi@$PI_IP:/home/pi/chiba/media/"
echo ""
echo "Service management:"
echo "  sudo systemctl start kiosk"
echo "  sudo systemctl stop kiosk"
echo "  sudo systemctl restart kiosk"
echo "  sudo systemctl status kiosk"
echo "  journalctl -u kiosk -f"
echo ""
echo "API:"
echo "  curl http://$PI_IP:8080/status"
echo "  curl http://$PI_IP:8080/files"
echo "  curl -X POST http://$PI_IP:8080/file -H 'Content-Type: application/json' -d '{\"file\":\"example.mp4\"}'"
echo "  curl -X POST http://$PI_IP:8080/off"
echo ""
echo "Player: http://$PI_IP:8080/player"
echo ""

read -p "Reboot now? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Remember to reboot for all changes to take effect."
else
    sudo reboot
fi
