#!/bin/bash
# Recover WiFi connectivity on a Pi (NetworkManager preferred, wpa_supplicant fallback).
#
# Intended for "walk up with keyboard" situations.
#
# Examples:
#   sudo ./scripts/pis/wifi-recover.sh --ssid BRAHMAN-AI --psk 'theall&everything'
#   sudo WIFI_PSK='theall&everything' ./scripts/pis/wifi-recover.sh --ssid BRAHMAN-AI --psk-env WIFI_PSK
#
# Output is intentionally compact so you can photograph it.

set -euo pipefail

SSID=""
PSK=""
PSK_ENV=""
COUNTRY=""
IFACE="wlan0"

usage() {
  cat <<'EOF'
Usage:
  wifi-recover.sh --ssid <name> [--psk <password> | --psk-env <ENVVAR>] [options]

Options:
  --iface wlan0        WiFi interface name (default: wlan0)
  --country US         Set WiFi regulatory domain (best effort)
  --help               Show help

Notes:
  - Prefers NetworkManager (nmcli). Falls back to appending to wpa_supplicant.conf if present.
  - Will disable WiFi powersave and enable autoconnect for the SSID if using NetworkManager.
EOF
}

is_ident() {
  [[ "${1:-}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ssid)
      SSID="${2:-}"
      shift 2
      ;;
    --ssid=*)
      SSID="${1#*=}"
      shift
      ;;
    --psk)
      PSK="${2:-}"
      shift 2
      ;;
    --psk=*)
      PSK="${1#*=}"
      shift
      ;;
    --psk-env)
      PSK_ENV="${2:-}"
      shift 2
      ;;
    --psk-env=*)
      PSK_ENV="${1#*=}"
      shift
      ;;
    --iface)
      IFACE="${2:-}"
      shift 2
      ;;
    --iface=*)
      IFACE="${1#*=}"
      shift
      ;;
    --country)
      COUNTRY="${2:-}"
      shift 2
      ;;
    --country=*)
      COUNTRY="${1#*=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$SSID" ]; then
  echo "ERROR: --ssid is required" >&2
  exit 2
fi

if [ -z "$PSK" ] && [ -n "$PSK_ENV" ] && is_ident "$PSK_ENV"; then
  PSK="${!PSK_ENV-}"
fi

if [ -z "$PSK" ]; then
  echo "ERROR: WiFi password required via --psk or --psk-env" >&2
  exit 2
fi

echo "=== wifi-recover ==="
echo "host: $(hostname)"
echo "date: $(date)"

echo ""
echo "=== link ==="
ip link show "$IFACE" 2>/dev/null | head -n 2 || true
rfkill list 2>/dev/null || true

if [ -n "$COUNTRY" ]; then
  echo ""
  echo "=== country ($COUNTRY) ==="
  if command -v raspi-config >/dev/null 2>&1; then
    raspi-config nonint do_wifi_country "$COUNTRY" 2>/dev/null || true
  fi
  if command -v iw >/dev/null 2>&1; then
    iw reg set "$COUNTRY" 2>/dev/null || true
    iw reg get 2>/dev/null | head -n 3 || true
  fi
fi

echo ""
echo "=== nmcli ==="
if command -v nmcli >/dev/null 2>&1; then
  nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev || true
  nmcli radio wifi on 2>/dev/null || true
  nmcli dev set "$IFACE" managed yes 2>/dev/null || true
  nmcli dev disconnect "$IFACE" 2>/dev/null || true
  nmcli dev wifi rescan 2>/dev/null || true

  echo ""
  echo "wifi list (top):"
  nmcli -f IN-USE,SSID,SIGNAL,SECURITY dev wifi list 2>/dev/null | head -n 12 || true

  # Ensure persistent profile.
  if ! nmcli connection show "$SSID" >/dev/null 2>&1; then
    nmcli connection add type wifi ifname "$IFACE" con-name "$SSID" ssid "$SSID" 2>/dev/null || true
  fi

  nmcli connection modify "$SSID" wifi-sec.key-mgmt wpa-psk 2>/dev/null || true
  nmcli connection modify "$SSID" wifi-sec.psk "$PSK" 2>/dev/null || true
  nmcli connection modify "$SSID" connection.autoconnect yes 2>/dev/null || true
  nmcli connection modify "$SSID" connection.autoconnect-priority 100 2>/dev/null || true
  nmcli connection modify "$SSID" 802-11-wireless.powersave 2 2>/dev/null || true
  nmcli connection modify "$SSID" 802-11-wireless.cloned-mac-address permanent 2>/dev/null || true

  nmcli connection up "$SSID" 2>/dev/null || true

else
  echo "nmcli not found"
fi

echo ""
echo "=== network ==="
ip -4 -br addr 2>/dev/null || true
ip route 2>/dev/null | head -n 5 || true

if command -v nmcli >/dev/null 2>&1; then
  echo ""
  echo "wlan0 details:"
  nmcli -g GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY dev show "$IFACE" 2>/dev/null || true
fi

echo ""
echo "=== services ==="
systemctl is-active NetworkManager 2>/dev/null || true
systemctl is-active wpa_supplicant 2>/dev/null || true
systemctl is-active dhcpcd 2>/dev/null || true
systemctl is-active avahi-daemon 2>/dev/null || true

