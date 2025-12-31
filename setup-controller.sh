#!/bin/bash
# Central Kiosk Controller Setup Script
# Run on a Linux box that will manage multiple Pis
#
# Usage:
#   ./setup-controller.sh --ngrok-token TOKEN --ngrok-domain DOMAIN
#
# Or without ngrok (for local network only):
#   ./setup-controller.sh --api-key YOUR_KEY

set -e

# Parse arguments
NGROK_AUTHTOKEN=""
NGROK_DOMAIN=""
API_KEY=""
DISCOVERY_PREFIX="mars"
DISCOVERY_MAX="20"

while [ $# -gt 0 ]; do
    case $1 in
        --ngrok-token=*)
            NGROK_AUTHTOKEN="${1#*=}"
            shift
            ;;
        --ngrok-token)
            NGROK_AUTHTOKEN="$2"
            shift 2
            ;;
        --ngrok-domain=*)
            NGROK_DOMAIN="${1#*=}"
            shift
            ;;
        --ngrok-domain)
            NGROK_DOMAIN="$2"
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
        --prefix=*)
            DISCOVERY_PREFIX="${1#*=}"
            shift
            ;;
        --prefix)
            DISCOVERY_PREFIX="$2"
            shift 2
            ;;
        --max=*)
            DISCOVERY_MAX="${1#*=}"
            shift
            ;;
        --max)
            DISCOVERY_MAX="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "ngrok options (for public access):"
            echo "  --ngrok-token    Your ngrok authtoken (from dashboard.ngrok.com)"
            echo "  --ngrok-domain   Static domain (e.g., controller.ngrok-free.app)"
            echo ""
            echo "Other options:"
            echo "  --api-key        API key for authenticating requests (auto-generated if not provided)"
            echo "  --prefix         Discovery hostname prefix (default: mars)"
            echo "  --max            Max number of Pis to scan (default: 20)"
            echo ""
            echo "Example:"
            echo "  $0 --ngrok-token XXX --ngrok-domain controller.ngrok-free.app"
            echo "  $0 --api-key mykey  # Local network only, no ngrok"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Generate API key if not provided
if [ -z "$API_KEY" ]; then
    API_KEY=$(openssl rand -hex 24)
    echo "Generated API key: $API_KEY"
fi

INSTALL_DIR="$HOME"
REPO_URL="https://github.com/mars-college/chiba.git"

echo "==========================================="
echo "  Kiosk Controller Setup"
echo "==========================================="
echo ""
echo "Install directory: $INSTALL_DIR/chiba"
echo "Discovery: ${DISCOVERY_PREFIX}01.local - ${DISCOVERY_PREFIX}$(printf '%02d' $DISCOVERY_MAX).local"
if [ -n "$NGROK_DOMAIN" ]; then
    echo "ngrok domain: $NGROK_DOMAIN"
else
    echo "ngrok: not configured (local network only)"
fi
echo ""

echo "=== Updating system ==="
sudo apt update

echo "=== Installing required packages ==="
sudo apt install -y \
    git \
    nodejs \
    npm \
    curl \
    wget \
    iputils-ping

# Install ngrok if token provided
if [ -n "$NGROK_AUTHTOKEN" ] && [ -n "$NGROK_DOMAIN" ]; then
    echo "=== Installing ngrok ==="

    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)
            NGROK_ARCH="amd64"
            ;;
        aarch64|arm64)
            NGROK_ARCH="arm64"
            ;;
        armv7l)
            NGROK_ARCH="arm"
            ;;
        *)
            echo "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    NGROK_VERSION="v3"
    wget -q "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-${NGROK_VERSION}-stable-linux-${NGROK_ARCH}.tgz" -O /tmp/ngrok.tgz
    sudo tar -xzf /tmp/ngrok.tgz -C /usr/local/bin
    sudo chmod +x /usr/local/bin/ngrok
    rm /tmp/ngrok.tgz

    # Configure ngrok
    ngrok config add-authtoken "$NGROK_AUTHTOKEN"
    echo "ngrok installed: $(ngrok version)"
fi

echo "=== Setting up repository ==="
cd "$INSTALL_DIR"

if [ -d "$INSTALL_DIR/chiba" ]; then
    echo "Repository exists, pulling latest..."
    cd "$INSTALL_DIR/chiba"
    git pull
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR/chiba"
    cd "$INSTALL_DIR/chiba"
fi

echo "=== Creating .env file ==="
cat > "$INSTALL_DIR/chiba/.env" << EOF
API_KEY=$API_KEY
DISCOVERY_PREFIX=$DISCOVERY_PREFIX
DISCOVERY_MAX=$DISCOVERY_MAX
EOF
chmod 600 "$INSTALL_DIR/chiba/.env"

echo "=== Installing Node.js dependencies ==="
cd "$INSTALL_DIR/chiba"
npm install dotenv

echo "=== Creating controller systemd service ==="
sudo tee /etc/systemd/system/kiosk-controller.service > /dev/null << EOF
[Unit]
Description=Kiosk Controller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$INSTALL_DIR/chiba
ExecStart=/usr/bin/node $INSTALL_DIR/chiba/controller.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Create ngrok service if configured
if [ -n "$NGROK_AUTHTOKEN" ] && [ -n "$NGROK_DOMAIN" ]; then
    echo "=== Creating ngrok systemd service ==="
    sudo tee /etc/systemd/system/ngrok.service > /dev/null << EOF
[Unit]
Description=ngrok tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
Environment=HOME=$HOME
ExecStart=/usr/local/bin/ngrok http 8080 --domain=$NGROK_DOMAIN
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
fi

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable kiosk-controller
sudo systemctl start kiosk-controller

if [ -n "$NGROK_AUTHTOKEN" ] && [ -n "$NGROK_DOMAIN" ]; then
    sudo systemctl enable ngrok
    sudo systemctl start ngrok
fi

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "==========================================="
echo "  Controller Setup Complete!"
echo "==========================================="
echo ""
echo "Controller is running at:"
if [ -n "$NGROK_DOMAIN" ]; then
    echo "  Public:  https://$NGROK_DOMAIN"
fi
echo "  Local:   http://$LOCAL_IP:8080"
echo ""
echo "============================================"
echo "  IMPORTANT: Save your API key!"
echo "============================================"
echo ""
echo "  API_KEY: $API_KEY"
echo ""
echo "  This key is required for POST requests."
echo ""
echo "============================================"
echo ""
echo "Discovery configuration:"
echo "  Prefix: $DISCOVERY_PREFIX"
echo "  Range:  ${DISCOVERY_PREFIX}01.local - ${DISCOVERY_PREFIX}$(printf '%02d' $DISCOVERY_MAX).local"
echo ""
echo "API examples:"
echo ""
echo "  # Discover Pis on the network"
if [ -n "$NGROK_DOMAIN" ]; then
    echo "  curl https://$NGROK_DOMAIN/discover"
else
    echo "  curl http://$LOCAL_IP:8080/discover"
fi
echo ""
echo "  # Check status of a specific Pi"
if [ -n "$NGROK_DOMAIN" ]; then
    echo "  curl 'https://$NGROK_DOMAIN/status?kiosk=mars01.local'"
else
    echo "  curl 'http://$LOCAL_IP:8080/status?kiosk=mars01.local'"
fi
echo ""
echo "  # Play video on a specific Pi"
if [ -n "$NGROK_DOMAIN" ]; then
    BASE_URL="https://$NGROK_DOMAIN"
else
    BASE_URL="http://$LOCAL_IP:8080"
fi
echo "  curl -X POST $BASE_URL/file \\"
echo "    -H 'Authorization: Bearer $API_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"kiosk\":\"mars01.local\", \"file\":\"video.mp4\"}'"
echo ""
echo "Service management:"
echo "  sudo systemctl status kiosk-controller"
echo "  sudo systemctl restart kiosk-controller"
echo "  journalctl -u kiosk-controller -f"
echo ""
