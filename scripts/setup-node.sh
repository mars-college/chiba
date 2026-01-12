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
#   curl -sL "https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh?v=$(date +%s)" | bash -s -- \
#     --controller-url http://192.168.1.100:8080 \
#     --node-name living-room
#
# Or download and run:
#   wget "https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh?v=$(date +%s)" -O setup-node.sh
#   chmod +x setup-node.sh
#   ./setup-node.sh --controller-url http://192.168.1.100:8080 --node-name living-room

set -e
set -x

# Log all output to a file in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/setup-node-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "Logging to: $LOG_FILE"

# Parse arguments
CONTROLLER_URL=""
NODE_NAME=""
API_KEY=""
EDEN_API_KEY=""
WIFI_SSID=""
WIFI_PASSWORD=""
DISPLAY_ROTATE="0"
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
        --wifi-ssid=*)
            WIFI_SSID="${1#*=}"
            shift
            ;;
        --wifi-ssid)
            WIFI_SSID="$2"
            shift 2
            ;;
        --wifi-password=*)
            WIFI_PASSWORD="${1#*=}"
            shift
            ;;
        --wifi-password)
            WIFI_PASSWORD="$2"
            shift 2
            ;;
        --display-rotate=*)
            DISPLAY_ROTATE="${1#*=}"
            shift
            ;;
        --display-rotate)
            DISPLAY_ROTATE="$2"
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
            echo "  --wifi-ssid        WiFi network name (ensures WiFi stays configured after upgrades)"
            echo "  --wifi-password    WiFi network password"
            echo "  --display-rotate   Display rotation: 0, 90, 180, 270 (default: 0)"
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

# Validate display rotation
case "$DISPLAY_ROTATE" in
    0|90|180|270) ;;
    *)
        echo "Error: --display-rotate must be 0, 90, 180, or 270"
        exit 1
        ;;
esac

echo "==========================================="
echo "  Chiba Node Setup"
echo "==========================================="
echo ""
echo "Node name:       $NODE_NAME"
echo "Controller URL:  $CONTROLLER_URL"
if [ -n "$WIFI_SSID" ]; then
    echo "WiFi SSID:       $WIFI_SSID"
    echo "WiFi Password:   ${WIFI_PASSWORD:0:3}***${WIFI_PASSWORD: -3} (length: ${#WIFI_PASSWORD})"
fi
echo "Display rotate:  $DISPLAY_ROTATE degrees"
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
# Install Node.js using NodeSource repository (requires Node >= 20)
NODE_MAJOR=$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo "0")
if ! command -v node &>/dev/null || [ "$NODE_MAJOR" -lt 20 ]; then
    echo "Node.js $NODE_MAJOR found, upgrading to 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js $NODE_MAJOR already meets requirement (>=20)"
fi
echo "Node.js installed: $(node -v)"
echo "npm installed: $(npm -v)"

echo "=== Installing pnpm 9 ==="
# Install or upgrade pnpm (requires pnpm >= 9)
PNPM_MAJOR=$(pnpm -v 2>/dev/null | cut -d. -f1 || echo "0")
if ! command -v pnpm &>/dev/null || [ "$PNPM_MAJOR" -lt 9 ]; then
    echo "pnpm $PNPM_MAJOR found, upgrading to 9..."
    sudo npm install -g pnpm@9
else
    echo "pnpm $PNPM_MAJOR already meets requirement (>=9)"
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
# Unset NODE_ENV to ensure devDependencies are installed (needed for build)
unset NODE_ENV
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

# Save display rotation setting
echo "$DISPLAY_ROTATE" > "$INSTALL_DIR/.display-rotate"
echo "Display rotation saved: $DISPLAY_ROTATE degrees"

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

echo "=== Creating network watchdog service ==="
# Copy network watchdog script
cp "$INSTALL_DIR/scripts/network-watchdog.sh" "$INSTALL_DIR/scripts/network-watchdog.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/scripts/network-watchdog.sh"

sudo tee /etc/systemd/system/chiba-network-watchdog.service > /dev/null << EOF
[Unit]
Description=Chiba Network Watchdog
After=network.target NetworkManager.service
Wants=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/scripts/network-watchdog.sh
Restart=always
RestartSec=30
Environment=CHECK_INTERVAL=30
Environment=FAILURE_THRESHOLD=3

[Install]
WantedBy=multi-user.target
EOF

echo "=== Enabling TTY2 for emergency terminal access ==="
# Enable getty on TTY2 so user can switch with Ctrl+Alt+F2
sudo systemctl enable getty@tty2.service 2>/dev/null || true

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
#
# EXIT KIOSK OPTIONS:
#   1. Press Ctrl+Alt+F2 to switch to TTY2 terminal (login as pi)
#   2. Click "Exit Kiosk" button in player UI
#   3. SSH in and run: sudo systemctl stop chiba-kiosk
#   4. SSH in and run: touch /tmp/chiba-exit-kiosk
#
# RETURN TO KIOSK:
#   Press Ctrl+Alt+F1 to switch back to kiosk TTY

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHIBA_DIR="$(dirname "$SCRIPT_DIR")"
EXIT_SIGNAL="/tmp/chiba-exit-kiosk"
ROTATE_CONFIG="$CHIBA_DIR/.display-rotate"

# Clean up any stale exit signal
rm -f "$EXIT_SIGNAL"

# Required environment for Wayland
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export WLR_NO_HARDWARE_CURSORS=1
# Allow VT switching with Ctrl+Alt+Fn keys
export WLR_LIBINPUT_NO_DEVICES=1

# Wait for node server to be ready
echo "Waiting for node server on port 8080..."
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "Server ready, launching kiosk..."
        break
    fi
    sleep 1
done

# Find chromium binary (name varies by OS version)
CHROMIUM_BIN="/usr/bin/chromium"
[ -x "/usr/bin/chromium-browser" ] && CHROMIUM_BIN="/usr/bin/chromium-browser"

# Chromium kiosk flags
CHROMIUM_FLAGS=(
    --kiosk
    --start-fullscreen
    --noerrdialogs
    --disable-infobars
    --disable-session-crashed-bubble
    --disable-restore-session-state
    --no-first-run
    --autoplay-policy=no-user-gesture-required
    --check-for-update-interval=31536000
    --disable-features=TranslateUI
    --disable-pinch
    --overscroll-history-navigation=0
    --disable-background-networking
    --disable-sync
    --password-store=basic
    --disable-breakpad
    --disable-dev-shm-usage
    --no-sandbox
)

# Function to apply display rotation after cage starts
apply_display_rotation() {
    if [ -f "$ROTATE_CONFIG" ]; then
        ROTATION=$(cat "$ROTATE_CONFIG")
        if [ "$ROTATION" != "0" ] && [ -n "$ROTATION" ]; then
            echo "Applying display rotation: $ROTATION degrees..."
            sleep 2  # Wait for cage to initialize
            OUTPUT=$(wlr-randr 2>/dev/null | grep -E "^[A-Z]+-[A-Z]?-?[0-9]+" | head -1 | awk '{print $1}')
            if [ -n "$OUTPUT" ]; then
                wlr-randr --output "$OUTPUT" --transform "$ROTATION" && \
                    echo "Display rotated to $ROTATION degrees" || \
                    echo "Failed to rotate display"
            fi
        fi
    fi
}

# Function to watch for exit signal
watch_exit_signal() {
    while true; do
        if [ -f "$EXIT_SIGNAL" ]; then
            echo "Exit signal detected, stopping kiosk..."
            rm -f "$EXIT_SIGNAL"
            # Kill cage using multiple methods for reliability
            # Method 1: Kill by process name
            pkill -9 cage 2>/dev/null
            # Method 2: Kill by pattern match
            pkill -9 -f "cage.*chromium" 2>/dev/null
            # Method 3: Kill all chromium under cage
            pkill -9 chromium 2>/dev/null
            pkill -9 chromium-browser 2>/dev/null
            # Method 4: Use killall as fallback
            killall -9 cage 2>/dev/null
            exit 0
        fi
        sleep 1
    done
}

# Start exit watcher in background
watch_exit_signal &
WATCHER_PID=$!

# Apply display rotation in background (after cage starts)
apply_display_rotation &

# Cleanup on script exit
cleanup() {
    kill $WATCHER_PID 2>/dev/null
    rm -f "$EXIT_SIGNAL"
}
trap cleanup EXIT

# Run Chromium in cage (Wayland compositor)
# -s flag enables VT switching (Ctrl+Alt+F1-F12)
cage -s -- $CHROMIUM_BIN "${CHROMIUM_FLAGS[@]}" http://localhost:8080/player

# If cage exits normally, clean up
cleanup
echo "Kiosk exited. You are now at a terminal."
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

# Configure WiFi if credentials provided (ensures WiFi works after package upgrades)
if [ -n "$WIFI_SSID" ] && [ -n "$WIFI_PASSWORD" ]; then
    echo "=== Configuring WiFi ==="
    # Use nmcli if NetworkManager is available (newer Pi OS)
    if command -v nmcli &>/dev/null; then
        nmcli device wifi connect "$WIFI_SSID" password "$WIFI_PASSWORD" wifi-sec.key-mgmt wpa-psk 2>/dev/null || \
        nmcli connection modify "$WIFI_SSID" connection.autoconnect yes 2>/dev/null || true
        echo "WiFi configured via NetworkManager: $WIFI_SSID"
    # Fall back to wpa_supplicant (older Pi OS)
    elif [ -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
        if ! grep -q "ssid=\"$WIFI_SSID\"" /etc/wpa_supplicant/wpa_supplicant.conf; then
            sudo tee -a /etc/wpa_supplicant/wpa_supplicant.conf > /dev/null << WPAEOF

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASSWORD"
}
WPAEOF
            sudo wpa_cli -i wlan0 reconfigure 2>/dev/null || true
            echo "WiFi configured via wpa_supplicant: $WIFI_SSID"
        fi
    fi
fi

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking
sudo systemctl enable chiba-node
sudo systemctl enable chiba-network-watchdog

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
systemctl is-enabled chiba-network-watchdog &>/dev/null && echo "  ✓ Network watchdog enabled" || echo "  ✗ Network watchdog NOT enabled"
systemctl is-enabled getty@tty2 &>/dev/null && echo "  ✓ Emergency TTY2 enabled (Ctrl+Alt+F2)" || echo "  ✗ Emergency TTY2 NOT enabled"
grep -q "run-kiosk.sh" "$HOME_DIR/.bash_profile" && echo "  ✓ Kiosk auto-start configured" || echo "  ✗ Kiosk auto-start NOT configured"
[ -f "$HOME_DIR/.asoundrc" ] && echo "  ✓ Audio configured ($AUDIO_DEVICE)" || echo "  ✗ Audio NOT configured"
[ -f "$INSTALL_DIR/.display-rotate" ] && echo "  ✓ Display rotation ($(cat "$INSTALL_DIR/.display-rotate") degrees)" || echo "  ✗ Display rotation NOT configured"
if [ -n "$WIFI_SSID" ]; then
    nmcli connection show "$WIFI_SSID" &>/dev/null && echo "  ✓ WiFi configured ($WIFI_SSID)" || echo "  ✗ WiFi NOT configured"
fi

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
echo "To change display rotation:"
echo "  $INSTALL_DIR/scripts/rotate-display.sh 90   # Portrait (90 degrees)"
echo "  $INSTALL_DIR/scripts/rotate-display.sh 270  # Portrait (270 degrees)"
echo "  $INSTALL_DIR/scripts/rotate-display.sh 0    # Landscape (default)"
echo ""
echo "============================================"
echo "  EMERGENCY KIOSK ACCESS"
echo "============================================"
echo ""
echo "If kiosk becomes unresponsive:"
echo "  1. Press Ctrl+Alt+F2 to switch to terminal (login as pi)"
echo "  2. Press Ctrl+Alt+F1 to return to kiosk"
echo "  3. SSH in: ssh pi@$PI_IP"
echo ""
echo "To exit kiosk mode:"
echo "  touch /tmp/chiba-exit-kiosk"
echo ""
echo "Network watchdog is enabled - WiFi will auto-reconnect"
echo "  Logs: journalctl -u chiba-network-watchdog -f"
echo ""

read -p "Reboot now to start kiosk? (Y/n) " -n 1 -r </dev/tty
echo
case "$REPLY" in
    [Nn]*) echo "Reboot when ready: sudo reboot" ;;
    *) sudo reboot ;;
esac
