#!/bin/bash
# Raspberry Pi Local Kiosk Setup Script
# Simplified setup for Pis controlled by central controller
# NO ngrok, NO API key authentication (local network trust)
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk-local.sh | bash
#
# Or with Eden API key:
#   ./setup-kiosk-local.sh --eden-key YOUR_EDEN_API_KEY

set -e

# Parse arguments
EDEN_API_KEY=""

while [ $# -gt 0 ]; do
    case $1 in
        --eden-key=*)
            EDEN_API_KEY="${1#*=}"
            shift
            ;;
        --eden-key)
            EDEN_API_KEY="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --eden-key    Eden API key for collection sync (optional)"
            echo ""
            echo "This script sets up a Pi as a local kiosk WITHOUT ngrok."
            echo "The Pi will be accessible on the local network at http://\$(hostname).local:8080"
            echo "Control via central controller using the Pi's hostname (e.g., mars01.local)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

INSTALL_DIR="/home/pi"
REPO_URL="https://github.com/mars-college/chiba.git"

echo "==========================================="
echo "  Raspberry Pi Local Kiosk Setup"
echo "==========================================="
echo ""
echo "Install directory: $INSTALL_DIR"
echo "Hostname: $(hostname).local"
echo ""
echo "NOTE: This Pi will NOT have ngrok."
echo "      Control via central controller only."
echo ""

# Check if running as pi user
if [ "$(whoami)" != "pi" ]; then
    echo "Warning: This script is designed to run as 'pi' user"
    echo "Current user: $(whoami)"
    read -p "Continue anyway? (y/N) " -n 1 -r </dev/tty
    echo
    case "$REPLY" in
        [Yy]*) ;;
        *) exit 1 ;;
    esac
fi

echo "=== Updating system ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing required packages ==="
# Note: NO ngrok installation
sudo apt install -y \
    git \
    cage \
    chromium \
    nodejs \
    npm \
    curl \
    wget \
    python3 \
    python3-pip \
    avahi-daemon

echo "=== Enabling mDNS (avahi) ==="
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

echo "=== Installing yt-dlp ==="
sudo pip3 install --break-system-packages yt-dlp 2>/dev/null || sudo pip3 install yt-dlp
if command -v yt-dlp &>/dev/null; then
    echo "yt-dlp installed: $(yt-dlp --version)"
else
    echo "Warning: yt-dlp installation may have failed"
fi

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

echo "=== Creating .env file ==="
# NOTE: No API_KEY = authentication disabled
cat > "$INSTALL_DIR/chiba/.env" << EOF
# No API_KEY = authentication disabled (local network trust)
# This Pi is controlled via central controller
EDEN_API_KEY=$EDEN_API_KEY
EOF
chmod 600 "$INSTALL_DIR/chiba/.env"

echo "=== Installing Node.js dependencies ==="
cd "$INSTALL_DIR/chiba"
npm install ws dotenv

echo "=== Configuring audio output ==="
USB_AUDIO=$(aplay -l 2>/dev/null | grep -E "^card [0-9]+" | grep -v "vc4-hdmi" | grep -v "bcm2835" | head -1 | sed -E 's/^card ([0-9]+): ([^ \[]+).*/\2/')

if [ -n "$USB_AUDIO" ]; then
    echo "Found USB audio device: $USB_AUDIO"
    AUDIO_DEVICE="$USB_AUDIO"
else
    echo "No USB audio device found, using headphone jack"
    AUDIO_DEVICE="Headphones"
fi

cat > ~/.asoundrc << EOF
pcm.!default {
    type plug
    slave.pcm "hw:${AUDIO_DEVICE},0"
}

ctl.!default {
    type hw
    card ${AUDIO_DEVICE}
}
EOF

echo "Audio configured to use: $AUDIO_DEVICE"

if aplay -l 2>/dev/null | grep -q "$AUDIO_DEVICE"; then
    amixer -c "$AUDIO_DEVICE" set PCM 100% unmute 2>/dev/null || \
    amixer -c "$AUDIO_DEVICE" set Speaker 100% unmute 2>/dev/null || \
    amixer -c "$AUDIO_DEVICE" set Master 100% unmute 2>/dev/null || true
    echo "Volume set to 100%"
fi

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
sudo raspi-config nonint do_boot_behaviour B2
sudo systemctl set-default multi-user.target
sudo systemctl disable lightdm 2>/dev/null || true
sudo systemctl disable gdm3 2>/dev/null || true

echo "=== Removing old services ==="
sudo systemctl stop kiosk 2>/dev/null || true
sudo systemctl disable kiosk 2>/dev/null || true
sudo rm -f /etc/systemd/system/kiosk.service
# Remove ngrok if it was previously installed
sudo systemctl stop ngrok 2>/dev/null || true
sudo systemctl disable ngrok 2>/dev/null || true
sudo rm -f /etc/systemd/system/ngrok.service

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking

echo "=== Setting up kiosk auto-start on login ==="
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
command -v yt-dlp &>/dev/null && echo "  ✓ yt-dlp installed ($(yt-dlp --version))" || echo "  ✗ yt-dlp MISSING"
systemctl is-active avahi-daemon &>/dev/null && echo "  ✓ mDNS (avahi) running" || echo "  ✗ mDNS NOT running"

echo ""
echo "Checking services..."
systemctl is-enabled disable-blanking &>/dev/null && echo "  ✓ screen blanking disabled" || echo "  ✗ screen blanking NOT enabled"
grep -q "run_kiosk.sh" ~/.bash_profile && echo "  ✓ kiosk auto-start configured" || echo "  ✗ kiosk auto-start NOT configured"
[ -f ~/.asoundrc ] && echo "  ✓ audio configured ($AUDIO_DEVICE)" || echo "  ✗ audio NOT configured"

# Note: No ngrok check since we don't use it
echo "  ✓ ngrok NOT installed (controlled via central controller)"

PI_IP=$(hostname -I | awk '{print $1}')
PI_HOSTNAME=$(hostname)

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "This kiosk is accessible at:"
echo "  Local:    http://$PI_IP:8080"
echo "  mDNS:     http://${PI_HOSTNAME}.local:8080"
echo ""
echo "Control this Pi via the central controller:"
echo ""
echo "  # From central controller"
echo "  curl 'http://CONTROLLER:8080/status?kiosk=${PI_HOSTNAME}.local'"
echo ""
echo "  # Play video"
echo "  curl -X POST http://CONTROLLER:8080/file \\"
echo "    -H 'Authorization: Bearer API_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"kiosk\":\"${PI_HOSTNAME}.local\", \"file\":\"video.mp4\"}'"
echo ""
echo "Player (local): http://$PI_IP:8080/player"
echo ""
echo "NOTE: This Pi has NO external access."
echo "      All control goes through the central controller."
echo ""

read -p "Reboot now to start kiosk? (Y/n) " -n 1 -r </dev/tty
echo
case "$REPLY" in
    [Nn]*) echo "Reboot when ready: sudo reboot" ;;
    *) sudo reboot ;;
esac
