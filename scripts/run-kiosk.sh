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
ROTATE_SIGNAL="/tmp/chiba-rotate-signal"
ROTATE_CONFIG="$CHIBA_DIR/.display-rotate"

# Clean up any stale signals
rm -f "$EXIT_SIGNAL"
rm -f "$ROTATE_SIGNAL"

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

# Convert rotation degrees to wlr-randr transform value
# wlr-randr expects: normal, 90, 180, 270 (not 0)
rotation_to_transform() {
    case "$1" in
        0) echo "normal" ;;
        90) echo "90" ;;
        180) echo "180" ;;
        270) echo "270" ;;
        *) echo "normal" ;;
    esac
}

# Function to apply display rotation after cage starts
apply_display_rotation() {
    if [ -f "$ROTATE_CONFIG" ]; then
        ROTATION=$(cat "$ROTATE_CONFIG")
        if [ -n "$ROTATION" ]; then
            TRANSFORM=$(rotation_to_transform "$ROTATION")
            # Skip if already at normal (no rotation needed)
            if [ "$TRANSFORM" != "normal" ]; then
                echo "Applying display rotation: $ROTATION degrees (transform: $TRANSFORM)..."
                sleep 2  # Wait for cage to initialize
                OUTPUT=$(wlr-randr 2>/dev/null | grep -E "^[A-Z]+-[A-Z]?-?[0-9]+" | head -1 | awk '{print $1}')
                if [ -n "$OUTPUT" ]; then
                    wlr-randr --output "$OUTPUT" --transform "$TRANSFORM" && \
                        echo "Display rotated to $ROTATION degrees" || \
                        echo "Failed to rotate display"
                fi
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

# Function to watch for rotation signal (triggered by node server API)
watch_rotation_signal() {
    while true; do
        if [ -f "$ROTATE_SIGNAL" ]; then
            NEW_ROTATION=$(cat "$ROTATE_SIGNAL")
            rm -f "$ROTATE_SIGNAL"
            if [ -n "$NEW_ROTATION" ]; then
                TRANSFORM=$(rotation_to_transform "$NEW_ROTATION")
                echo "Rotation signal detected: $NEW_ROTATION degrees (transform: $TRANSFORM)"
                OUTPUT=$(wlr-randr 2>/dev/null | grep -E "^[A-Z]+-[A-Z]?-?[0-9]+" | head -1 | awk '{print $1}')
                if [ -n "$OUTPUT" ]; then
                    wlr-randr --output "$OUTPUT" --transform "$TRANSFORM" && \
                        echo "Display rotated to $NEW_ROTATION degrees" || \
                        echo "Failed to rotate display"
                else
                    echo "No display output detected for rotation"
                fi
            fi
        fi
        sleep 0.5
    done
}

# Start exit watcher in background
watch_exit_signal &
EXIT_WATCHER_PID=$!

# Start rotation signal watcher in background
watch_rotation_signal &
ROTATE_WATCHER_PID=$!

# Apply display rotation in background (after cage starts)
apply_display_rotation &

# Cleanup on script exit
cleanup() {
    kill $EXIT_WATCHER_PID 2>/dev/null
    kill $ROTATE_WATCHER_PID 2>/dev/null
    rm -f "$EXIT_SIGNAL"
    rm -f "$ROTATE_SIGNAL"
}
trap cleanup EXIT

# Run Chromium in cage (Wayland compositor)
# -s flag enables VT switching (Ctrl+Alt+F1-F12)
cage -s -- $CHROMIUM_BIN "${CHROMIUM_FLAGS[@]}" http://localhost:8080/player

# If cage exits normally, clean up
cleanup
echo "Kiosk exited. You are now at a terminal."
