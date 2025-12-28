#!/bin/bash
# Full kiosk mode: starts Node server + Chromium browser in kiosk mode
# For Raspberry Pi with Wayland/cage

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export XDG_RUNTIME_DIR=/run/user/$(id -u)
export WLR_NO_HARDWARE_CURSORS=1

# Disable screen blanking
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Start the Node server in background
node "$SCRIPT_DIR/server.js" &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Chromium flags optimized for Pi kiosk
CHROMIUM_FLAGS=(
    --kiosk
    --start-fullscreen
    --window-size=1920,1080
    --window-position=0,0
    --noerrdialogs
    --disable-infobars
    --disable-session-crashed-bubble
    --disable-restore-session-state
    --no-first-run
    --disable-translate
    --disable-features=TranslateUI,PasswordManager
    --disable-component-update
    --check-for-update-interval=31536000
    --disable-pinch
    --overscroll-history-navigation=0
    --autoplay-policy=no-user-gesture-required
    --disable-background-networking
    --disable-sync
    --hide-scrollbars
    --disable-extensions
    --disable-default-apps
    --disable-breakpad
    --disable-crash-reporter
    --disable-dev-shm-usage
    --no-sandbox
    --disable-gpu-vsync
    --enable-gpu-rasterization
    --enable-zero-copy
    --ignore-gpu-blocklist
    # Disable keyring/password prompts
    --password-store=basic
    # Audio
    --alsa-output-device=default
    --enable-features=AudioServiceOutOfProcess
)

# Launch browser in cage (Wayland compositor)
cage -- /usr/bin/chromium "${CHROMIUM_FLAGS[@]}" "http://localhost:8080/player"

# Cleanup when browser exits
kill $SERVER_PID 2>/dev/null
