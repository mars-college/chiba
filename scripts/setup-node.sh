#!/bin/bash
# Chiba Node Setup Script for Raspberry Pi
# Run on a fresh Raspberry Pi OS 64-bit install
#
# This script sets up a Pi as a Chiba kiosk node:
# - Installs required packages (Node.js, yt-dlp, Chromium, etc.)
# - Configures audio output (USB or headphone jack)
# - Disables screen blanking and sleep
# - Sets up auto-start on boot
# - Configures the node to auto-register with the controller
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh | bash -s -- \
#     --controller-url http://192.168.1.100:8080 \
#     --node-name living-room
#
# Or download and run:
#   wget https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh
#   chmod +x setup-node.sh
#   ./setup-node.sh --controller-url http://192.168.1.100:8080 --node-name living-room

set -e

# Parse arguments
CONTROLLER_URL=""
NODE_NAME=""
API_KEY=""
EDEN_API_KEY=""
INSTALL_DIR="/home/pi/chiba"
REPO_URL="https://github.com/mars-college/chiba.git"

while [ $# -gt 0 ]; do
    case $1 in
        --controller-url=*)
            CONTROLLER_URL="${1#*=}"
            shift
            ;;
        --controller-url)
            CONTROLLER_URL="$2"
            shift 2
            ;;
        --node-name=*)
            NODE_NAME="${1#*=}"
            shift
            ;;
        --node-name)
            NODE_NAME="$2"
            shift 2
            ;;
        --api-key=*)
            API_KEY="${1#*=}"
            shift
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --eden-key=*)
            EDEN_API_KEY="${1#*=}"
            shift
            ;;
        --eden-key)
            EDEN_API_KEY="$2"
            shift 2
            ;;
        --install-dir=*)
            INSTALL_DIR="${1#*=}"
            shift
            ;;
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 --controller-url URL --node-name NAME [OPTIONS]"
            echo ""
            echo "Required:"
            echo "  --controller-url   URL of the Chiba controller (e.g., http://192.168.1.100:8080)"
            echo "  --node-name        Friendly name for this node (e.g., living-room, bedroom)"
            echo ""
            echo "Optional:"
            echo "  --api-key          API key for authenticating requests (auto-generated if not provided)"
            echo "  --eden-key         Eden API key for collection sync"
            echo "  --install-dir      Installation directory (default: /home/pi/chiba)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required args
if [ -z "$CONTROLLER_URL" ]; then
    echo "Error: --controller-url is required"
    echo "This is the URL of your Chiba controller server"
    exit 1
fi

if [ -z "$NODE_NAME" ]; then
    echo "Error: --node-name is required"
    echo "Choose a friendly name like: living-room, bedroom, office"
    exit 1
fi

# Generate API key if not provided
if [ -z "$API_KEY" ]; then
    API_KEY=$(openssl rand -hex 24)
    echo "Generated API key: $API_KEY"
fi

echo "==========================================="
echo "  Chiba Node Setup"
echo "==========================================="
echo ""
echo "Node name:       $NODE_NAME"
echo "Controller URL:  $CONTROLLER_URL"
echo "Install dir:     $INSTALL_DIR"
echo ""

# Check if running as pi user
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" != "pi" ]; then
    echo "Warning: This script is designed to run as 'pi' user"
    echo "Current user: $CURRENT_USER"
    read -p "Continue anyway? (y/N) " -n 1 -r </dev/tty
    echo
    case "$REPLY" in
        [Yy]*) ;;
        *) exit 1 ;;
    esac
fi

HOME_DIR=$(eval echo ~$CURRENT_USER)

echo "=== Updating system ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing required packages ==="
# chromium-browser was renamed to chromium in newer Raspberry Pi OS
# Check which package is actually installable
if apt-cache policy chromium 2>/dev/null | grep -q "Candidate:"; then
    CHROMIUM_PKG="chromium"
elif apt-cache policy chromium-browser 2>/dev/null | grep -q "Candidate:"; then
    CHROMIUM_PKG="chromium-browser"
else
    echo "Warning: No Chromium package found, skipping..."
    CHROMIUM_PKG=""
fi

sudo apt install -y \
    git \
    cage \
    ${CHROMIUM_PKG:+$CHROMIUM_PKG} \
    curl \
    wget \
    python3 \
    python3-pip \
    build-essential \
    alsa-utils

echo "=== Installing Node.js 20 ==="
# Install Node.js using NodeSource repository
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js installed: $(node -v)"
echo "npm installed: $(npm -v)"

echo "=== Installing pnpm ==="
if ! command -v pnpm &>/dev/null; then
    sudo npm install -g pnpm
fi
echo "pnpm installed: $(pnpm -v)"

echo "=== Installing yt-dlp ==="
sudo pip3 install --break-system-packages yt-dlp 2>/dev/null || sudo pip3 install yt-dlp
if command -v yt-dlp &>/dev/null; then
    echo "yt-dlp installed: $(yt-dlp --version)"
else
    echo "Warning: yt-dlp installation may have failed"
fi

echo "=== Setting up Chiba ==="
# Clone or update repository
if [ -d "$INSTALL_DIR" ]; then
    echo "Repository exists, pulling latest..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/main
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Create media directory
mkdir -p "$INSTALL_DIR/media"
mkdir -p "$INSTALL_DIR/data"

echo "=== Installing dependencies ==="
cd "$INSTALL_DIR"
pnpm install

echo "=== Building packages ==="
pnpm build

echo "=== Creating .env file ==="
cat > "$INSTALL_DIR/.env" << EOF
# Chiba Node Configuration
NODE_NAME=$NODE_NAME
CONTROLLER_URL=$CONTROLLER_URL
API_KEY=$API_KEY
EDEN_API_KEY=$EDEN_API_KEY
PORT=8080
LOG_LEVEL=info
EOF
chmod 600 "$INSTALL_DIR/.env"

echo "=== Configuring audio output ==="
# Find USB audio device (exclude HDMI and built-in headphones)
USB_AUDIO=$(aplay -l 2>/dev/null | grep -E "^card [0-9]+" | grep -v "vc4-hdmi" | grep -v "bcm2835" | head -1 | sed -E 's/^card ([0-9]+): ([^ \[]+).*/\2/')

if [ -n "$USB_AUDIO" ]; then
    echo "Found USB audio device: $USB_AUDIO"
    AUDIO_DEVICE="$USB_AUDIO"
else
    echo "No USB audio device found, using headphone jack"
    AUDIO_DEVICE="Headphones"
fi

# Create ALSA config to set default audio output
cat > "$HOME_DIR/.asoundrc" << EOF
# Default audio output device for Chiba
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

# Set volume to 100%
if aplay -l 2>/dev/null | grep -q "$AUDIO_DEVICE"; then
    amixer -c "$AUDIO_DEVICE" set PCM 100% unmute 2>/dev/null || \
    amixer -c "$AUDIO_DEVICE" set Speaker 100% unmute 2>/dev/null || \
    amixer -c "$AUDIO_DEVICE" set Master 100% unmute 2>/dev/null || true
    echo "Volume set to 100%"
fi

echo "=== Setting environment variables ==="
# Add to /etc/environment for all users
sudo grep -q "NODE_ENV=production" /etc/environment || \
    echo "NODE_ENV=production" | sudo tee -a /etc/environment

# Add to user profile
grep -q "export NODE_ENV=production" "$HOME_DIR/.profile" || \
    echo "export NODE_ENV=production" >> "$HOME_DIR/.profile"

grep -q "export XDG_RUNTIME_DIR=/run/user/$(id -u)" "$HOME_DIR/.profile" || \
    echo "export XDG_RUNTIME_DIR=/run/user/$(id -u)" >> "$HOME_DIR/.profile"

echo "=== Disabling screen blanking ==="
# Create systemd service to disable blanking
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

# Add console blanking disable to kernel cmdline
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

echo "=== Creating Chiba node systemd service ==="
sudo tee /etc/systemd/system/chiba-node.service > /dev/null << EOF
[Unit]
Description=Chiba Node Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$INSTALL_DIR/packages/node
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo "=== Configuring boot options ==="
# Set console auto-login
sudo raspi-config nonint do_boot_behaviour B2 2>/dev/null || true

# Set to multi-user target (no GUI desktop)
sudo systemctl set-default multi-user.target

# Disable desktop managers if present
sudo systemctl disable lightdm 2>/dev/null || true
sudo systemctl disable gdm3 2>/dev/null || true

echo "=== Setting up kiosk auto-start ==="
# Create kiosk launcher script
cat > "$INSTALL_DIR/scripts/run-kiosk.sh" << 'EOF'
#!/bin/bash
# Chiba Kiosk Launcher
# Runs Chromium in kiosk mode connecting to the local node server

# Wait for node server to be ready
echo "Waiting for node server..."
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "Node server is ready"
        break
    fi
    sleep 1
done

# Chromium kiosk flags
CHROMIUM_FLAGS=(
    --kiosk
    --noerrdialogs
    --disable-infobars
    --disable-session-crashed-bubble
    --disable-restore-session-state
    --no-first-run
    --start-fullscreen
    --autoplay-policy=no-user-gesture-required
    --check-for-update-interval=31536000
    --disable-features=TranslateUI
    --disable-pinch
    --overscroll-history-navigation=0
    --disable-background-networking
    --disable-sync
)

# Find chromium binary (name varies by OS version)
CHROMIUM_BIN="chromium"
command -v chromium-browser &>/dev/null && CHROMIUM_BIN="chromium-browser"

# Run Chromium in cage (Wayland compositor)
exec cage -- $CHROMIUM_BIN "${CHROMIUM_FLAGS[@]}" http://localhost:8080/player
EOF
chmod +x "$INSTALL_DIR/scripts/run-kiosk.sh"

# Set up auto-start on TTY1 login
cat > "$HOME_DIR/.bash_profile" << EOF
# Chiba kiosk auto-start (only on TTY1)
if [ "\$(tty)" = "/dev/tty1" ]; then
    # Start the kiosk
    cd $INSTALL_DIR && ./scripts/run-kiosk.sh
fi
EOF

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking
sudo systemctl enable chiba-node

echo "=== Verifying installation ==="
echo ""
echo "Checking installed components..."
[ -d "$INSTALL_DIR/packages/node" ] && echo "  ✓ Node package" || echo "  ✗ Node package MISSING"
[ -d "$INSTALL_DIR/packages/player" ] && echo "  ✓ Player package" || echo "  ✗ Player package MISSING"
[ -f "$INSTALL_DIR/.env" ] && echo "  ✓ .env configured" || echo "  ✗ .env MISSING"
[ -f "$INSTALL_DIR/scripts/run-kiosk.sh" ] && echo "  ✓ Kiosk launcher" || echo "  ✗ Kiosk launcher MISSING"
command -v node &>/dev/null && echo "  ✓ Node.js $(node -v)" || echo "  ✗ Node.js MISSING"
command -v pnpm &>/dev/null && echo "  ✓ pnpm $(pnpm -v)" || echo "  ✗ pnpm MISSING"
command -v yt-dlp &>/dev/null && echo "  ✓ yt-dlp $(yt-dlp --version 2>/dev/null)" || echo "  ✗ yt-dlp MISSING"

echo ""
echo "Checking services..."
systemctl is-enabled disable-blanking &>/dev/null && echo "  ✓ Screen blanking disabled" || echo "  ✗ Screen blanking NOT enabled"
systemctl is-enabled chiba-node &>/dev/null && echo "  ✓ Chiba node service enabled" || echo "  ✗ Chiba node service NOT enabled"
grep -q "run-kiosk.sh" "$HOME_DIR/.bash_profile" && echo "  ✓ Kiosk auto-start configured" || echo "  ✗ Kiosk auto-start NOT configured"
[ -f "$HOME_DIR/.asoundrc" ] && echo "  ✓ Audio configured ($AUDIO_DEVICE)" || echo "  ✗ Audio NOT configured"

PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "Node name:       $NODE_NAME"
echo "Controller URL:  $CONTROLLER_URL"
echo "Local IP:        http://$PI_IP:8080"
echo ""
echo "============================================"
echo "  IMPORTANT: Save your API key!"
echo "============================================"
echo ""
echo "  API_KEY: $API_KEY"
echo ""
echo "  This key is required for authenticated requests."
echo "  Store it securely - it won't be shown again."
echo ""
echo "============================================"
echo ""
echo "After reboot:"
echo "  1. The node server will start automatically"
echo "  2. The kiosk display will launch on login"
echo "  3. The node will register with the controller at:"
echo "     $CONTROLLER_URL"
echo ""
echo "To manually control the node:"
echo "  sudo systemctl start chiba-node    # Start node server"
echo "  sudo systemctl stop chiba-node     # Stop node server"
echo "  sudo systemctl status chiba-node   # Check status"
echo "  journalctl -u chiba-node -f        # View logs"
echo ""

read -p "Reboot now to start kiosk? (Y/n) " -n 1 -r </dev/tty
echo
case "$REPLY" in
    [Nn]*) echo "Reboot when ready: sudo reboot" ;;
    *) sudo reboot ;;
esac
