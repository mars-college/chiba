#!/bin/bash
# Kiosk Client - Example script to test remote control
# Usage: ./kiosk-client.sh <pi-ip-address>

HOST="${1:-10.10.13.241}"
PORT="8080"
BASE="http://${HOST}:${PORT}"

echo "=== Kiosk Client Test (Instant Switching) ==="
echo "Target: $BASE"
echo ""

# Helper function
call() {
    method="$1"
    endpoint="$2"
    data="$3"

    echo ">> $method $endpoint"
    if [ "$method" = "GET" ]; then
        curl -s "$BASE$endpoint" | jq .
    else
        curl -s -X POST -H "Content-Type: application/json" -d "$data" "$BASE$endpoint" | jq .
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

echo "--- Test 4: INSTANT switch to example2.mp4 (3 seconds) ---"
call POST /file '{"file": "example2.mp4"}'
sleep 3

echo "--- Test 5: INSTANT switch back to example.mp4 (3 seconds) ---"
call POST /file '{"file": "example.mp4"}'
sleep 3

echo "--- Test 6: INSTANT switch to example2.mp4 again (3 seconds) ---"
call POST /file '{"file": "example2.mp4"}'
sleep 3

echo "--- Test 7: Show a website (3 seconds) ---"
call POST /url '{"url": "https://www.wikipedia.org"}'
sleep 3

echo "--- Test 8: Back to video (3 seconds) ---"
call POST /file '{"file": "example.mp4"}'
sleep 3

echo "--- Test 9: Turn off (black screen, 2 seconds) ---"
call POST /off '{}'
sleep 2

echo "--- Test 10: Back on with video ---"
call POST /file '{"file": "example.mp4"}'
sleep 2

echo "--- Test 11: Final status ---"
call GET /status

echo ""
echo "=== Test complete (~30 seconds) ==="
echo ""
echo "Quick commands:"
echo "  # Switch videos"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"file\":\"example.mp4\"}' $BASE/file"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"file\":\"example2.mp4\"}' $BASE/file"
echo ""
echo "  # Show websites"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"url\":\"https://app.eden.art/collections/68538ccaf883914b6b8e09a1\"}' $BASE/url"
echo "  curl -X POST -H 'Content-Type: application/json' -d '{\"url\":\"https://wikipedia.org\"}' $BASE/url"
echo ""
echo "  # Control"
echo "  curl -X POST $BASE/off"
echo "  curl $BASE/status"
echo "  curl $BASE/files"
