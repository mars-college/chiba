#!/bin/bash
# Kiosk Status Check
# Run this to verify everything is running correctly

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Kiosk Status ==="
echo ""

# Check processes
echo "Processes:"
if pgrep -x node > /dev/null; then
    echo -e "  ${GREEN}✓${NC} Node server running (PID: $(pgrep -x node))"
else
    echo -e "  ${RED}✗${NC} Node server NOT running"
fi

if pgrep -x chromium > /dev/null || pgrep -f "chromium" > /dev/null; then
    echo -e "  ${GREEN}✓${NC} Chromium running"
else
    echo -e "  ${RED}✗${NC} Chromium NOT running"
fi

if pgrep -x cage > /dev/null; then
    echo -e "  ${GREEN}✓${NC} Cage (Wayland) running"
else
    echo -e "  ${YELLOW}○${NC} Cage NOT running (ok if not on Pi)"
fi

echo ""

# Check server response
echo "Server:"
if curl -s --max-time 2 http://localhost:8080/status > /dev/null 2>&1; then
    STATUS=$(curl -s --max-time 2 http://localhost:8080/status)
    MODE=$(echo "$STATUS" | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
    FILE=$(echo "$STATUS" | grep -o '"file":"[^"]*"' | cut -d'"' -f4)
    CLIENTS=$(echo "$STATUS" | grep -o '"wsClients":[0-9]*' | cut -d':' -f2)

    echo -e "  ${GREEN}✓${NC} Server responding on port 8080"
    echo "  Mode: $MODE"
    [ -n "$FILE" ] && [ "$FILE" != "null" ] && echo "  File: $FILE"
    echo "  WebSocket clients: $CLIENTS"

    if [ "$CLIENTS" = "0" ]; then
        echo -e "  ${YELLOW}⚠${NC}  No browser connected"
    fi
else
    echo -e "  ${RED}✗${NC} Server NOT responding on port 8080"
fi

echo ""

# Check media files
echo "Media files:"
if [ -d "$SCRIPT_DIR/media" ]; then
    COUNT=$(ls -1 "$SCRIPT_DIR/media" 2>/dev/null | grep -E '\.(mp4|webm|mov|mkv)$' | wc -l | tr -d ' ')
    echo "  $COUNT video(s) in media/"
    ls -1 "$SCRIPT_DIR/media" 2>/dev/null | grep -E '\.(mp4|webm|mov|mkv)$' | head -5 | while read f; do
        echo "    - $f"
    done
    [ "$COUNT" -gt 5 ] && echo "    ... and $((COUNT - 5)) more"
else
    echo -e "  ${YELLOW}○${NC} media/ directory not found"
fi

echo ""

# Check .env
echo "Configuration:"
if [ -f "$SCRIPT_DIR/.env" ]; then
    if grep -q "EDEN_API_KEY" "$SCRIPT_DIR/.env"; then
        echo -e "  ${GREEN}✓${NC} EDEN_API_KEY configured"
    else
        echo -e "  ${YELLOW}○${NC} EDEN_API_KEY not set in .env"
    fi
else
    echo -e "  ${YELLOW}○${NC} .env file not found (needed for /sync)"
fi

echo ""

# Quick commands
echo "Quick commands:"
echo "  Start kiosk:  cd ~/chiba && ./run_kiosk.sh"
echo "  Start server: cd ~/chiba && node server.js"
echo "  Play video:   curl -X POST http://localhost:8080/file -H 'Content-Type: application/json' -d '{\"file\":\"example.mp4\"}'"
echo "  Stop:         pkill -f 'node.*server'"
echo ""
