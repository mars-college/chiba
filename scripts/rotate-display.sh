#!/bin/bash
# Rotate display using wlr-randr (Wayland)
# Usage: rotate-display.sh [0|90|180|270]
#
# Also saves the setting for persistence across reboots.

ROTATION="${1:-0}"
CONFIG_FILE="${CHIBA_DIR:-/home/pi/chiba}/.display-rotate"

# Validate input
case "$ROTATION" in
    0|90|180|270)
        ;;
    normal)
        ROTATION=0
        ;;
    right)
        ROTATION=90
        ;;
    inverted)
        ROTATION=180
        ;;
    left)
        ROTATION=270
        ;;
    *)
        echo "Usage: $0 [0|90|180|270|normal|right|inverted|left]"
        echo ""
        echo "  0 / normal   - No rotation (landscape)"
        echo "  90 / right   - 90 degrees clockwise (portrait)"
        echo "  180 / inverted - 180 degrees (upside down)"
        echo "  270 / left   - 270 degrees clockwise (portrait, other way)"
        echo ""
        echo "Current setting: $(cat "$CONFIG_FILE" 2>/dev/null || echo "0")"
        exit 1
        ;;
esac

# Detect the output name
OUTPUT=$(wlr-randr 2>/dev/null | grep -E "^[A-Z]+-[A-Z]?-?[0-9]+" | head -1 | awk '{print $1}')

if [ -z "$OUTPUT" ]; then
    echo "Warning: Could not detect display output (Wayland not running?)"
    echo "Saving setting for next boot..."
else
    echo "Rotating $OUTPUT to $ROTATION degrees..."
    wlr-randr --output "$OUTPUT" --transform "$ROTATION"

    if [ $? -eq 0 ]; then
        echo "Display rotated successfully"
    else
        echo "Failed to rotate display"
        exit 1
    fi
fi

# Save for persistence
echo "$ROTATION" > "$CONFIG_FILE"
echo "Saved rotation setting to $CONFIG_FILE"
echo "This will persist across reboots."
