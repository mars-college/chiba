#!/bin/bash
# Initialize secrets for Chiba deployment
# Usage: ./scripts/init-secrets.sh [--eden-key YOUR_EDEN_KEY]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"

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
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--eden-key YOUR_EDEN_KEY]"
            exit 1
            ;;
    esac
done

# Check if .env exists
if [ -f "$ENV_FILE" ]; then
    echo "Existing .env found:"
    echo "---"
    cat "$ENV_FILE"
    echo "---"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Generate API key
API_KEY=$(openssl rand -hex 24)

# Write .env
cat > "$ENV_FILE" << EOF
# Chiba Secrets
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

API_KEY=$API_KEY
EDEN_API_KEY=$EDEN_API_KEY
EOF

chmod 600 "$ENV_FILE"

echo ""
echo "=================================="
echo "  Secrets initialized"
echo "=================================="
echo ""
echo "API_KEY:      $API_KEY"
if [ -n "$EDEN_API_KEY" ]; then
    echo "EDEN_API_KEY: $EDEN_API_KEY"
else
    echo "EDEN_API_KEY: (not set)"
fi
echo ""
echo "Saved to: $ENV_FILE"
echo ""
echo "=================================="
echo "  Deploy to Pi"
echo "=================================="
echo ""
echo "Copy and run on each Pi (replace CONTROLLER_IP and NODE_NAME):"
echo ""

if [ -n "$EDEN_API_KEY" ]; then
    cat << EOF
curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh | bash -s -- \\
  --controller-url http://CONTROLLER_IP:8080 \\
  --node-name NODE_NAME \\
  --api-key "$API_KEY" \\
  --eden-key "$EDEN_API_KEY"
EOF
else
    cat << EOF
curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh | bash -s -- \\
  --controller-url http://CONTROLLER_IP:8080 \\
  --node-name NODE_NAME \\
  --api-key "$API_KEY"
EOF
fi

echo ""
