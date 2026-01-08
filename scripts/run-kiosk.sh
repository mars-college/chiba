#!/bin/bash
# Chiba Kiosk Launcher
# Run this after the node server is up

PORT=${PORT:-8080}
URL="http://localhost:${PORT}/player"

# Wait for server
echo "Waiting for node server on port $PORT..."
while ! curl -s "http://localhost:${PORT}/status" > /dev/null; do
  sleep 1
done
echo "Server ready, launching kiosk..."

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Find chromium binary (name varies by OS version)
CHROMIUM_BIN="chromium"
command -v chromium-browser &>/dev/null && CHROMIUM_BIN="chromium-browser"

# Launch Chromium in kiosk mode
$CHROMIUM_BIN \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --app="$URL"
