#!/bin/bash
# Raspberry Pi Kiosk Setup Script
# Run on a fresh Raspberry Pi OS 64-bit install
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh | bash -s -- \
#     --ngrok-token YOUR_NGROK_TOKEN \
#     --ngrok-domain your-domain.ngrok-free.app \
#     --eden-key YOUR_EDEN_API_KEY
#
# Or download and run:
#   wget https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh
#   chmod +x setup-kiosk.sh
#   ./setup-kiosk.sh --ngrok-token XXX --ngrok-domain XXX --eden-key YYY

set -e

# Parse arguments
NGROK_AUTHTOKEN=""
NGROK_DOMAIN=""
EDEN_API_KEY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --ngrok-token)
            NGROK_AUTHTOKEN="$2"
            shift 2
            ;;
        --ngrok-domain)
            NGROK_DOMAIN="$2"
            shift 2
            ;;
        --eden-key)
            EDEN_API_KEY="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 --ngrok-token TOKEN --ngrok-domain DOMAIN [--eden-key KEY]"
            echo ""
            echo "Required:"
            echo "  --ngrok-token    Your ngrok authtoken (from dashboard.ngrok.com)"
            echo "  --ngrok-domain   Static domain for this Pi (e.g., pi01.ngrok-free.app)"
            echo ""
            echo "Optional:"
            echo "  --eden-key       Eden API key for collection sync"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required args
if [ -z "$NGROK_AUTHTOKEN" ]; then
    echo "Error: --ngrok-token is required"
    echo "Get your token at: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

if [ -z "$NGROK_DOMAIN" ]; then
    echo "Error: --ngrok-domain is required"
    echo "Create a free static domain at: https://dashboard.ngrok.com/cloud-edge/domains"
    exit 1
fi

INSTALL_DIR="/home/pi"
REPO_URL="https://github.com/mars-college/chiba.git"

echo "==========================================="
echo "  Raspberry Pi Kiosk Setup"
echo "==========================================="
echo ""
echo "Install directory: $INSTALL_DIR"
echo "ngrok domain: $NGROK_DOMAIN"
echo ""

# Check if running as pi user
if [ "$(whoami)" != "pi" ]; then
    echo "Warning: This script is designed to run as 'pi' user"
    echo "Current user: $(whoami)"
    read -p "Continue anyway? (y/N) " -n 1 -r </dev/tty
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
    npm \
    curl \
    wget

echo "=== Installing ngrok (arm64) ==="
# Download ngrok directly for arm64
NGROK_VERSION="v3"
wget -q https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-${NGROK_VERSION}-stable-linux-arm64.tgz -O /tmp/ngrok.tgz
sudo tar -xzf /tmp/ngrok.tgz -C /usr/local/bin
sudo chmod +x /usr/local/bin/ngrok
rm /tmp/ngrok.tgz

# Verify ngrok installed
if ! command -v ngrok &>/dev/null; then
    echo "Error: ngrok installation failed"
    exit 1
fi
echo "ngrok installed: $(ngrok version)"

# Configure ngrok
ngrok config add-authtoken "$NGROK_AUTHTOKEN"

echo "=== Cleaning up old installation ==="
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

# Configure git for this user
git config --global user.email "pi@localhost"
git config --global user.name "pi"

if [ -d "$INSTALL_DIR/chiba" ]; then
    echo "Repository exists, pulling latest..."
    cd "$INSTALL_DIR/chiba"
    git reset --hard HEAD
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
chmod +x "$INSTALL_DIR/chiba/status.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/chiba/setup-kiosk.sh" 2>/dev/null || true

echo "=== Creating .env file ==="
cat > "$INSTALL_DIR/chiba/.env" << EOF
EDEN_API_KEY=$EDEN_API_KEY
NGROK_AUTHTOKEN=$NGROK_AUTHTOKEN
NGROK_DOMAIN=$NGROK_DOMAIN
EOF
chmod 600 "$INSTALL_DIR/chiba/.env"

echo "=== Installing Node.js dependencies ==="
cd "$INSTALL_DIR/chiba"
npm install ws dotenv

echo "=== Setting environment variables ==="
sudo grep -q "NODE_ENV=production" /etc/environment || \
    echo "NODE_ENV=production" | sudo tee -a /etc/environment

grep -q "export NODE_ENV=production" ~/.profile || \
    echo "export NODE_ENV=production" >> ~/.profile

grep -q "export XDG_RUNTIME_DIR=/run/user/1000" ~/.profile || \
    echo "export XDG_RUNTIME_DIR=/run/user/1000" >> ~/.profile

echo "=== Disabling screen blanking ==="
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

echo "=== Creating ngrok systemd service ==="
sudo tee /etc/systemd/system/ngrok.service > /dev/null << EOF
[Unit]
Description=ngrok tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
Environment=HOME=/home/pi
ExecStart=/usr/local/bin/ngrok http 8080 --domain=$NGROK_DOMAIN
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo "=== Configuring boot options ==="
sudo raspi-config nonint do_boot_behaviour B2
sudo systemctl set-default multi-user.target
sudo systemctl disable lightdm 2>/dev/null || true
sudo systemctl disable gdm3 2>/dev/null || true

echo "=== Removing old services ==="
sudo systemctl stop kiosk 2>/dev/null || true
sudo systemctl disable kiosk 2>/dev/null || true
sudo rm -f /etc/systemd/system/kiosk.service

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking
sudo systemctl enable ngrok

echo "=== Setting up kiosk auto-start on login ==="
# Completely rewrite .bash_profile to avoid corruption
cat > ~/.bash_profile << 'EOF'
# Kiosk auto-start (only on TTY1 with display)
if [ "$(tty)" = "/dev/tty1" ]; then
    cd ~/chiba && ./run_kiosk.sh
fi
EOF

echo "=== Verifying installation ==="
echo ""
echo "Checking installed files..."
[ -f "$INSTALL_DIR/chiba/server.js" ] && echo "  ✓ server.js" || echo "  ✗ server.js MISSING"
[ -f "$INSTALL_DIR/chiba/run_kiosk.sh" ] && echo "  ✓ run_kiosk.sh" || echo "  ✗ run_kiosk.sh MISSING"
[ -f "$INSTALL_DIR/chiba/public/index.html" ] && echo "  ✓ public/index.html" || echo "  ✗ public/index.html MISSING"
[ -d "$INSTALL_DIR/chiba/node_modules/ws" ] && echo "  ✓ node_modules/ws" || echo "  ✗ node_modules/ws MISSING"
[ -f "$INSTALL_DIR/chiba/.env" ] && echo "  ✓ .env configured" || echo "  ✗ .env MISSING"
command -v ngrok &>/dev/null && echo "  ✓ ngrok installed ($(ngrok version))" || echo "  ✗ ngrok MISSING"

echo ""
echo "Checking services..."
systemctl is-enabled disable-blanking &>/dev/null && echo "  ✓ screen blanking disabled" || echo "  ✗ screen blanking NOT enabled"
systemctl is-enabled ngrok &>/dev/null && echo "  ✓ ngrok service enabled" || echo "  ✗ ngrok service NOT enabled"
grep -q "run_kiosk.sh" ~/.bash_profile && echo "  ✓ kiosk auto-start configured" || echo "  ✗ kiosk auto-start NOT configured"

# Test ngrok connection
echo ""
echo "Testing ngrok..."
timeout 10 ngrok http 8080 --domain="$NGROK_DOMAIN" &
NGROK_PID=$!
sleep 5
if kill -0 $NGROK_PID 2>/dev/null; then
    echo "  ✓ ngrok tunnel working"
    kill $NGROK_PID 2>/dev/null || true
else
    echo "  ✗ ngrok tunnel failed - check your token and domain"
fi

PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "After reboot, your kiosk will be available at:"
echo "  Public:  https://$NGROK_DOMAIN"
echo "  Local:   http://$PI_IP:8080"
echo ""
echo "API examples:"
echo "  curl https://$NGROK_DOMAIN/status"
echo "  curl https://$NGROK_DOMAIN/files"
echo "  curl -X POST https://$NGROK_DOMAIN/sync_and_play \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"collectionId\":\"YOUR_COLLECTION_ID\"}'"
echo ""
echo "Player: https://$NGROK_DOMAIN/player"
echo ""
echo "To check status: cd ~/chiba && ./status.sh"
echo ""

read -p "Reboot now to start kiosk? (Y/n) " -n 1 -r </dev/tty
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Reboot when ready: sudo reboot"
else
    sudo reboot
fi
