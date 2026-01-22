#!/bin/bash
# Setup ngrok tunnel for Chiba controller
# Run ON the controller machine (Pi or server)
#
# Usage:
#   ./setup-ngrok.sh --token YOUR_AUTHTOKEN --domain your-domain.ngrok-free.app
#
# To remove ngrok:
#   ./setup-ngrok.sh --remove

set -e

NGROK_AUTHTOKEN=""
NGROK_DOMAIN=""
NGROK_PORT=""
REMOVE=false

while [ $# -gt 0 ]; do
    case $1 in
        --token=*)
            NGROK_AUTHTOKEN="${1#*=}"
            shift
            ;;
        --token)
            NGROK_AUTHTOKEN="$2"
            shift 2
            ;;
        --domain=*)
            NGROK_DOMAIN="${1#*=}"
            shift
            ;;
        --domain)
            NGROK_DOMAIN="$2"
            shift 2
            ;;
        --port=*)
            NGROK_PORT="${1#*=}"
            shift
            ;;
        --port)
            NGROK_PORT="$2"
            shift 2
            ;;
        --remove)
            REMOVE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --token     Your ngrok authtoken (from dashboard.ngrok.com)"
            echo "  --domain    Static domain (e.g., your-app.ngrok-free.app)"
            echo "  --port      Controller port (default: 24422)"
            echo "  --remove    Remove ngrok service"
            echo ""
            echo "Example:"
            echo "  $0 --token XXX --domain myapp.ngrok-free.app --port 24422"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Handle removal
if [ "$REMOVE" = true ]; then
    echo "=== Removing ngrok service ==="
    sudo systemctl stop ngrok 2>/dev/null || true
    sudo systemctl disable ngrok 2>/dev/null || true
    sudo rm -f /etc/systemd/system/ngrok.service
    sudo systemctl daemon-reload
    echo "ngrok service removed."
    exit 0
fi

# Validate required args
if [ -z "$NGROK_AUTHTOKEN" ] || [ -z "$NGROK_DOMAIN" ]; then
    echo "Error: --token and --domain are required"
    echo "Run '$0 --help' for usage"
    exit 1
fi

# Default port for chiba controller
NGROK_PORT="${NGROK_PORT:-24422}"

echo "==========================================="
echo "  ngrok Setup for Chiba Controller"
echo "==========================================="
echo ""
echo "Domain: $NGROK_DOMAIN"
echo "Port:   $NGROK_PORT"
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
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

    echo "ngrok installed: $(ngrok version)"
else
    echo "ngrok already installed: $(ngrok version)"
fi

# Configure authtoken
echo "=== Configuring ngrok authtoken ==="
ngrok config add-authtoken "$NGROK_AUTHTOKEN"

# Create systemd service
echo "=== Creating ngrok systemd service ==="
sudo tee /etc/systemd/system/ngrok.service > /dev/null << EOF
[Unit]
Description=ngrok tunnel for Chiba controller
After=network-online.target chiba-controller.service
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
Environment=HOME=$HOME
ExecStart=/usr/local/bin/ngrok http $NGROK_PORT --domain=$NGROK_DOMAIN
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
echo "=== Starting ngrok service ==="
sudo systemctl daemon-reload
sudo systemctl enable ngrok
sudo systemctl restart ngrok

# Wait a moment for it to start
sleep 2

echo ""
echo "==========================================="
echo "  ngrok Setup Complete!"
echo "==========================================="
echo ""
echo "Your controller is now accessible at:"
echo "  https://$NGROK_DOMAIN"
echo ""
echo "Service management:"
echo "  sudo systemctl status ngrok"
echo "  sudo systemctl restart ngrok"
echo "  journalctl -u ngrok -f"
echo ""
echo "To remove ngrok:"
echo "  $0 --remove"
echo ""
