#!/bin/bash
# Run the signage server (Node.js)
# Access the player at http://<IP>:8080/player

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not installed. Run: sudo apt install nodejs npm"
    exit 1
fi

exec node "$SCRIPT_DIR/server.js"
