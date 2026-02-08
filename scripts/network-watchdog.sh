#!/bin/bash
# Chiba Network Watchdog
# Monitors network connectivity and automatically recovers from dropouts
#
# This script runs as a systemd service and:
# 1. Periodically checks if we have a real IP address
# 2. Pings the gateway to verify connectivity
# 3. If network is down, attempts recovery:
#    - Restarts wlan0 interface
#    - Reconnects to WiFi via NetworkManager
#    - As last resort, restarts NetworkManager service
#
# Install: sudo systemctl enable chiba-network-watchdog
# Logs: journalctl -u chiba-network-watchdog -f

set -e

# Configuration
CHECK_INTERVAL=${CHECK_INTERVAL:-30}        # Check every 30 seconds
FAILURE_THRESHOLD=${FAILURE_THRESHOLD:-3}   # Consecutive failures before action
PING_TIMEOUT=${PING_TIMEOUT:-5}             # Ping timeout in seconds
# In solar/offline setups you often still want local WiFi/LAN to be considered "online"
# even if the WAN uplink is down. Set to 1 to require internet pings too.
REQUIRE_INTERNET=${REQUIRE_INTERNET:-0}
LOG_PREFIX="[network-watchdog]"

# Auto-reboot configuration
# Use /var/tmp so the flag survives reboots (unlike /tmp).
AUTO_REBOOT_FLAG="/var/tmp/chiba-auto-reboot-enabled"
REBOOT_FAILURE_THRESHOLD=${REBOOT_FAILURE_THRESHOLD:-20}  # ~10 min of failures before reboot
REBOOT_COOLDOWN=${REBOOT_COOLDOWN:-3600}                  # Min 1 hour between reboots
REBOOT_TRACKING_FILE="/var/tmp/chiba-last-reboot"         # Persists across script restarts
MAX_CONSECUTIVE_REBOOTS=${MAX_CONSECUTIVE_REBOOTS:-3}     # Give up after this many
REBOOT_COUNT_FILE="/var/tmp/chiba-reboot-count"           # Track consecutive reboots
NODE_PORT=${NODE_PORT:-8080}                              # Chiba node port

# State
failure_count=0
last_recovery_time=0
recovery_cooldown=120  # Wait 2 minutes between recovery attempts

log() {
    echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
    echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $1" >&2
}

# Get the primary IP address (excluding loopback)
get_ip() {
    hostname -I 2>/dev/null | awk '{print $1}'
}

# Get the default gateway
get_gateway() {
    ip route | grep default | awk '{print $3}' | head -1
}

# Check if we have a valid IP (not 127.x.x.x or empty)
has_valid_ip() {
    local ip=$(get_ip)
    if [ -z "$ip" ]; then
        return 1
    fi
    if [[ "$ip" == 127.* ]]; then
        return 1
    fi
    return 0
}

# Check if we can reach the gateway
can_reach_gateway() {
    local gateway=$(get_gateway)
    if [ -z "$gateway" ]; then
        return 1
    fi
    ping -c 1 -W "$PING_TIMEOUT" "$gateway" > /dev/null 2>&1
}

# Check if we can reach the internet (using multiple targets)
can_reach_internet() {
    # Try Google DNS, Cloudflare DNS, and Quad9 DNS
    for target in 8.8.8.8 1.1.1.1 9.9.9.9; do
        if ping -c 1 -W "$PING_TIMEOUT" "$target" > /dev/null 2>&1; then
            return 0
        fi
    done
    return 1
}

# Get WiFi interface name
get_wifi_interface() {
    # Look for wlan interfaces
    for iface in /sys/class/net/wlan*; do
        if [ -e "$iface" ]; then
            basename "$iface"
            return 0
        fi
    done
    return 1
}

# Get currently connected WiFi SSID
get_connected_ssid() {
    if command -v nmcli &>/dev/null; then
        nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2
    else
        iwgetid -r 2>/dev/null
    fi
}

# Best-effort: disable WiFi power save. Some Pi WiFi chipsets get "sticky" after AP outages.
disable_wifi_powersave() {
    local iface
    iface=$(get_wifi_interface 2>/dev/null || true)
    if [ -z "${iface:-}" ]; then
        return 0
    fi

    if command -v iw &>/dev/null; then
        iw dev "$iface" set power_save off 2>/dev/null || true
    fi
    if command -v iwconfig &>/dev/null; then
        iwconfig "$iface" power off 2>/dev/null || true
    fi
}

# Recovery Level 1: Restart the WiFi interface
recover_wifi_interface() {
    local iface=$(get_wifi_interface)
    if [ -z "$iface" ]; then
        log_error "No WiFi interface found"
        return 1
    fi

    log "Recovery L1: Restarting WiFi interface $iface"

    # Bring interface down and up
    sudo ip link set "$iface" down 2>/dev/null || true
    sleep 2
    sudo ip link set "$iface" up 2>/dev/null || true
    sleep 5

    # Request DHCP lease
    if command -v dhclient &>/dev/null; then
        sudo dhclient -r "$iface" 2>/dev/null || true
        sudo dhclient "$iface" 2>/dev/null || true
    elif command -v dhcpcd &>/dev/null; then
        # Common on Raspberry Pi OS.
        sudo dhcpcd -n "$iface" 2>/dev/null || true
        sudo systemctl restart dhcpcd 2>/dev/null || true
    fi

    return 0
}

# Recovery Level 2: Reconnect to WiFi via NetworkManager
recover_networkmanager() {
    if ! command -v nmcli &>/dev/null; then
        log "NetworkManager not available, skipping L2 recovery"
        return 1
    fi

    log "Recovery L2: Reconnecting via NetworkManager"

    local iface=$(get_wifi_interface)
    if [ -z "$iface" ]; then
        return 1
    fi

    # Turn WiFi off and on
    nmcli radio wifi off 2>/dev/null || true
    sleep 3
    nmcli radio wifi on 2>/dev/null || true
    sleep 5

    # Try to reconnect to any known network
    nmcli device wifi rescan 2>/dev/null || true
    sleep 3
    nmcli device connect "$iface" 2>/dev/null || true

    return 0
}

# Recovery Level 3: Restart NetworkManager service
recover_restart_networkmanager() {
    log "Recovery L3: Restarting NetworkManager service"

    sudo systemctl restart NetworkManager 2>/dev/null || \
    sudo systemctl restart networking 2>/dev/null || \
    sudo service networking restart 2>/dev/null || true

    sleep 10
    return 0
}

# Recovery Level 4: Full network stack restart
recover_full_restart() {
    log "Recovery L4: Full network stack restart"

    local iface=$(get_wifi_interface)

    # Kill any stuck DHCP clients
    sudo pkill -9 dhclient 2>/dev/null || true
    sudo pkill -9 wpa_supplicant 2>/dev/null || true

    sleep 2

    # Restart all network services
    sudo systemctl restart NetworkManager 2>/dev/null || true
    sudo systemctl restart wpa_supplicant 2>/dev/null || true

    sleep 10

    # Bring interface up explicitly
    if [ -n "$iface" ]; then
        sudo ip link set "$iface" up 2>/dev/null || true
    fi

    return 0
}

# =============================================================================
# Auto-reboot functionality (Recovery Level 5)
# =============================================================================

# Check if auto-reboot is enabled
is_auto_reboot_enabled() {
    [ -f "$AUTO_REBOOT_FLAG" ]
}

# Check if node is idle (not playing anything)
is_node_idle() {
    # Try to query the node's status endpoint
    local response
    response=$(curl -s --connect-timeout 2 "http://localhost:${NODE_PORT}/status" 2>/dev/null)

    if [ -z "$response" ]; then
        # Can't reach node server - assume idle (server might be down)
        log "Cannot reach node server, assuming idle"
        return 0
    fi

    # Extract playback mode from JSON response
    # Expected: {"success":true,"data":{"playback":{"mode":"off",...},...}}
    local mode
    mode=$(echo "$response" | grep -o '"mode":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ "$mode" = "off" ]; then
        return 0  # Idle
    else
        log "Node is playing (mode: $mode), not safe to reboot"
        return 1  # Not idle
    fi
}

# Get time of last reboot (0 if never)
get_last_reboot_time() {
    if [ -f "$REBOOT_TRACKING_FILE" ]; then
        cat "$REBOOT_TRACKING_FILE"
    else
        echo 0
    fi
}

# Get consecutive reboot count
get_reboot_count() {
    if [ -f "$REBOOT_COUNT_FILE" ]; then
        cat "$REBOOT_COUNT_FILE"
    else
        echo 0
    fi
}

# Reset reboot count (call when network recovers)
reset_reboot_count() {
    rm -f "$REBOOT_COUNT_FILE" 2>/dev/null || true
}

# Recovery Level 5: Auto-reboot (last resort)
recover_reboot() {
    if ! is_auto_reboot_enabled; then
        log "Auto-reboot not enabled (touch $AUTO_REBOOT_FLAG to enable)"
        return 1
    fi

    # Check cooldown
    local current_time=$(date +%s)
    local last_reboot=$(get_last_reboot_time)
    local time_since_reboot=$((current_time - last_reboot))

    if [ $time_since_reboot -lt $REBOOT_COOLDOWN ]; then
        log "Reboot cooldown active (${time_since_reboot}s < ${REBOOT_COOLDOWN}s), waiting..."
        return 1
    fi

    # Check consecutive reboot limit
    local reboot_count=$(get_reboot_count)
    if [ $reboot_count -ge $MAX_CONSECUTIVE_REBOOTS ]; then
        log_error "Max consecutive reboots ($MAX_CONSECUTIVE_REBOOTS) reached without recovery"
        log_error "Manual intervention required. Reset with: rm $REBOOT_COUNT_FILE"
        return 1
    fi

    # Check if node is idle
    if ! is_node_idle; then
        log "Skipping reboot - content is playing"
        return 1
    fi

    # All checks passed - perform reboot
    log "Recovery L5: AUTO-REBOOT - All recovery attempts exhausted"
    log "Reboot #$((reboot_count + 1)) of max $MAX_CONSECUTIVE_REBOOTS"

    # Update tracking files
    echo "$current_time" > "$REBOOT_TRACKING_FILE"
    echo $((reboot_count + 1)) > "$REBOOT_COUNT_FILE"

    # Give a moment for logs to flush
    sleep 2

    # Reboot!
    sudo reboot

    # Should never reach here
    exit 0
}

# Main recovery function - tries progressively more aggressive fixes
attempt_recovery() {
    local current_time=$(date +%s)
    local time_since_last=$((current_time - last_recovery_time))

    if [ $time_since_last -lt $recovery_cooldown ]; then
        log "Recovery cooldown active (${time_since_last}s < ${recovery_cooldown}s), waiting..."
        return 1
    fi

    last_recovery_time=$current_time
    local recovery_level=$((failure_count / FAILURE_THRESHOLD))

    case $recovery_level in
        1)
            recover_wifi_interface
            ;;
        2)
            recover_networkmanager
            ;;
        3)
            recover_restart_networkmanager
            ;;
        4)
            recover_full_restart
            ;;
        *)
            # Level 5+: Try full restart again, then consider reboot
            recover_full_restart
            # If we've been failing long enough, try auto-reboot
            if [ $failure_count -ge $REBOOT_FAILURE_THRESHOLD ]; then
                recover_reboot
            fi
            ;;
    esac

    # Wait for network to come up
    sleep 10
}

# Check network health and report status
check_network() {
    local status="unknown"
    local ip=$(get_ip)
    local gateway=$(get_gateway)
    local ssid=$(get_connected_ssid)

    if ! has_valid_ip; then
        status="no_ip"
        log_error "No valid IP address (got: ${ip:-none})"
        return 1
    fi

    if ! can_reach_gateway; then
        status="no_gateway"
        log_error "Cannot reach gateway $gateway (IP: $ip)"
        return 1
    fi

    if [ "$REQUIRE_INTERNET" -eq 1 ]; then
        if ! can_reach_internet; then
            status="no_internet"
            log_error "Cannot reach internet (IP: $ip, Gateway: $gateway)"
            return 1
        fi
    fi

    status="online"
    return 0
}

# Main monitoring loop
main() {
    log "Starting network watchdog"
    log "Check interval: ${CHECK_INTERVAL}s, Failure threshold: $FAILURE_THRESHOLD"
    log "Require internet: $REQUIRE_INTERNET"

    # Show auto-reboot status
    if is_auto_reboot_enabled; then
        log "Auto-reboot: ENABLED (after $REBOOT_FAILURE_THRESHOLD failures, max $MAX_CONSECUTIVE_REBOOTS reboots)"
    else
        log "Auto-reboot: disabled (touch $AUTO_REBOOT_FLAG to enable)"
    fi

    # Initial status
    local ip=$(get_ip)
    local ssid=$(get_connected_ssid)
    log "Initial state - IP: ${ip:-none}, SSID: ${ssid:-none}"

    while true; do
        disable_wifi_powersave
        if check_network; then
            if [ $failure_count -gt 0 ]; then
                log "Network recovered after $failure_count failures"
                ip=$(get_ip)
                ssid=$(get_connected_ssid)
                log "Online - IP: $ip, SSID: ${ssid:-wired}"
                # Reset reboot count since we recovered successfully
                reset_reboot_count
            fi
            failure_count=0
        else
            failure_count=$((failure_count + 1))
            log_error "Network check failed ($failure_count consecutive failures)"

            if [ $failure_count -ge $FAILURE_THRESHOLD ]; then
                log "Failure threshold reached, attempting recovery..."
                attempt_recovery
            fi
        fi

        sleep "$CHECK_INTERVAL"
    done
}

# Handle signals gracefully
trap 'log "Shutting down"; exit 0' SIGTERM SIGINT

# Run main loop
main
