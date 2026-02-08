#!/bin/bash
# Toggle or check auto-reboot feature for network watchdog
#
# Usage:
#   ./auto-reboot.sh          # Show current status
#   ./auto-reboot.sh on       # Enable auto-reboot
#   ./auto-reboot.sh off      # Disable auto-reboot
#   ./auto-reboot.sh reset    # Reset reboot counter (after manual intervention)

FLAG_FILE="/var/tmp/chiba-auto-reboot-enabled"
REBOOT_COUNT_FILE="/var/tmp/chiba-reboot-count"

show_status() {
    echo "Auto-reboot status:"
    if [ -f "$FLAG_FILE" ]; then
        echo "  Enabled: YES"
    else
        echo "  Enabled: NO"
    fi

    if [ -f "$REBOOT_COUNT_FILE" ]; then
        local count=$(cat "$REBOOT_COUNT_FILE")
        echo "  Consecutive reboots: $count"
    else
        echo "  Consecutive reboots: 0"
    fi
}

case "${1:-status}" in
    on|enable)
        touch "$FLAG_FILE"
        echo "Auto-reboot ENABLED"
        echo "The node will reboot after ~10 min of network failures (if idle)"
        ;;
    off|disable)
        rm -f "$FLAG_FILE"
        echo "Auto-reboot DISABLED"
        ;;
    reset)
        rm -f "$REBOOT_COUNT_FILE"
        echo "Reboot counter reset"
        ;;
    status|*)
        show_status
        ;;
esac
