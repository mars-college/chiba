#!/bin/bash
# Kiosk Client - Example script to test remote control
#
# Usage:
#   ./kiosk-client.sh                           # localhost, no auth
#   ./kiosk-client.sh 192.168.1.100             # custom IP, no auth
#   ./kiosk-client.sh 192.168.1.100 YOUR_API_KEY # custom IP with auth
#   API_KEY=xxx ./kiosk-client.sh               # localhost with auth via env

HOST="${1:-localhost}"
PORT="8080"
BASE="http://${HOST}:${PORT}"

# API key from argument or environment variable
API_KEY="${2:-$API_KEY}"

echo "=== Kiosk Client Test ==="
echo "Target: $BASE"
if [ -n "$API_KEY" ]; then
    echo "Auth: Bearer token configured"
else
    echo "Auth: None (POST requests may fail if server requires auth)"
fi
echo ""

# Helper function
call() {
    method="$1"
    endpoint="$2"
    data="$3"

    echo ">> $method $endpoint"
    if [ "$method" = "GET" ]; then
        curl -s "$BASE$endpoint" | jq . 2>/dev/null || cat
    else
        if [ -n "$API_KEY" ]; then
            curl -s -X POST \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "$data" "$BASE$endpoint" | jq . 2>/dev/null || cat
        else
            curl -s -X POST \
                -H "Content-Type: application/json" \
                -d "$data" "$BASE$endpoint" | jq . 2>/dev/null || cat
        fi
    fi
    echo ""
}

echo "--- Test 1: Check status ---"
call GET /status
sleep 1

echo "--- Test 2: List available files ---"
call GET /files
sleep 1

echo "--- Test 3: Play example.mp4 (3 seconds) ---"
call POST /file '{"file": "example.mp4"}'
sleep 3

echo "--- Test 4: Switch to example2.mp4 (3 seconds) ---"
call POST /file '{"file": "example2.mp4"}'
sleep 3

echo "--- Test 5: Show a website (3 seconds) ---"
call POST /url '{"url": "https://www.wikipedia.org"}'
sleep 3

echo "--- Test 6: Back to video (3 seconds) ---"
call POST /file '{"file": "example.mp4"}'
sleep 3

echo "--- Test 7: Turn off (black screen, 2 seconds) ---"
call POST /off '{}'
sleep 2

echo "--- Test 8: Final status ---"
call GET /status

echo ""
echo "=== Test complete ==="
echo ""
echo "Quick commands (add -H 'Authorization: Bearer YOUR_KEY' for auth):"
echo ""
echo "  # Check status (no auth required)"
echo "  curl $BASE/status"
echo ""
echo "  # Play video"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"file\":\"example.mp4\"}' $BASE/file"
echo ""
echo "  # Play playlist"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"urls\":[\"video1.mp4\",\"video2.mp4\"]}' $BASE/playlist"
echo ""
echo "  # Show website"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com\"}' $BASE/url"
echo ""
echo "  # Turn off display"
echo "  curl -X POST $BASE/off"
echo ""
