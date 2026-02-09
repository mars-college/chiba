#!/usr/bin/env bash
set -euo pipefail

#
# net-diag.sh
# Quick connectivity diagnosis for a set of Pis when mDNS / WiFi mesh is flaky.
#
# Usage:
#   PI_PASSWORD=interact ./scripts/pis/net-diag.sh mars32.local mars07.local mars23.local mars29.local
#
# Notes:
# - Uses the first arg as the jump host (defaults to user "pi" if not provided).
# - Probes from laptop AND from the jump host.
# - If reachable from the jump host, gathers a small set of network facts from the target Pi.
#

usage() {
  echo "Usage: PI_PASSWORD=interact $0 <jump-host> <target-host> [target-host ...]"
  echo "Example: PI_PASSWORD=interact $0 mars32.local mars07.local mars23.local mars29.local"
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

JUMP_RAW="$1"
shift
TARGETS=("$@")

USER="pi"

JUMP="$JUMP_RAW"
if [[ "$JUMP" != *@* ]]; then
  JUMP="${USER}@${JUMP}"
fi

SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=5
  -o ConnectionAttempts=1
  -o ServerAliveInterval=3
  -o ServerAliveCountMax=1
  -o LogLevel=ERROR
)

SSH=(ssh "${SSH_OPTS[@]}")
if [ -n "${PI_PASSWORD:-}" ] && command -v sshpass >/dev/null 2>&1; then
  SSH=(sshpass -p "$PI_PASSWORD" ssh "${SSH_OPTS[@]}")
fi

JUMP_HOST="${JUMP#*@}"

wifi_device_mac() {
  # Returns device name for Wi-Fi if available (en0/en1/...)
  # Uses networksetup which is stable on macOS.
  networksetup -listallhardwareports 2>/dev/null | awk '
    $0 ~ /^Hardware Port: Wi-Fi$/ { wifi=1; next }
    wifi && $0 ~ /^Device: / { print $2; exit }
  ' || true
}

mac_hw_ports() {
  networksetup -listallhardwareports 2>/dev/null | sed -n '1,200p' || true
}

mac_route_iface_for_ip() {
  local ip="$1"
  route -n get "$ip" 2>/dev/null | awk '/interface:/{print $2; exit}' || true
}

resolve_ip_mac() {
  # Best-effort: pulls the current resolved IP (often via mDNSResponder cache)
  # Output: ip or empty
  local host="$1"
  dscacheutil -q host -a name "$host" 2>/dev/null | awk '/ip_address:/{print $2; exit}' || true
}

JUMP_IP="$(resolve_ip_mac "$JUMP_HOST")"
MAC_IFACE=""
if [ -n "$JUMP_IP" ]; then
  MAC_IFACE="$(mac_route_iface_for_ip "$JUMP_IP")"
fi
if [ -z "$MAC_IFACE" ]; then
  MAC_IFACE="en0"
fi
MAC_IP="$(ipconfig getifaddr "$MAC_IFACE" 2>/dev/null || true)"
if [ -z "$MAC_IP" ]; then
  MAC_IP="UNKNOWN"
fi

mac_wifi_info() {
  local airport
  local wifi_dev
  airport="/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport"
  wifi_dev="$(wifi_device_mac)"

  echo "--- hardware ports ---"
  mac_hw_ports

  if command -v wdutil >/dev/null 2>&1; then
    echo "--- wdutil info ---"
    # wdutil usually requires sudo; try non-interactive first.
    if sudo -n true 2>/dev/null; then
      sudo -n wdutil info 2>/dev/null | sed -n '1,160p' || true
    else
      echo "(wdutil requires sudo; run 'sudo -v' then rerun net-diag for richer Wi-Fi details)"
    fi
  fi
  if command -v scutil >/dev/null 2>&1; then
    echo "--- scutil --nwi ---"
    scutil --nwi 2>/dev/null | sed -n '1,120p' || true
  fi
  if [ -n "$wifi_dev" ]; then
    echo "--- networksetup Wi-Fi ---"
    networksetup -getairportnetwork "$wifi_dev" 2>/dev/null || true
  fi
  if [ -x "$airport" ]; then
    "$airport" -I 2>/dev/null | sed -n '1,80p' || true
    if [ -n "$wifi_dev" ]; then
      echo "wifi_device: $wifi_dev"
    fi
  else
    echo "(airport tool not found)"
  fi
}

probe_laptop() {
  local host="$1"
  local ip=""
  ip="$(resolve_ip_mac "$host")"
  echo "laptop: dns_ip=${ip:-?}"
  if [ -n "$ip" ]; then
    ping -c 1 -W 1000 "$ip" >/dev/null 2>&1 && echo "laptop: ping=OK" || echo "laptop: ping=FAIL"
    nc -vz -w 2 "$ip" 22 >/dev/null 2>&1 && echo "laptop: tcp22=OK" || echo "laptop: tcp22=FAIL"
  else
    ping -c 1 -W 1000 "$host" >/dev/null 2>&1 && echo "laptop: ping=OK" || echo "laptop: ping=FAIL"
    nc -vz -w 2 "$host" 22 >/dev/null 2>&1 && echo "laptop: tcp22=OK" || echo "laptop: tcp22=FAIL"
  fi
  if [ -n "$ip" ]; then
    arp -n "$ip" 2>/dev/null | sed -n '1p' | sed 's/^/laptop: arp=/' || echo "laptop: arp=?"
  else
    echo "laptop: arp=?"
  fi
}

probe_from_jump() {
  local host="$1"
  "${SSH[@]}" "$JUMP" "set -e
H='$host'
IP=\$(getent hosts \"\$H\" 2>/dev/null | awk '{print \$1; exit}' || true)
echo \"jump: dns_ip=\${IP:-?}\"
ping -c 1 -W 1 \"\$H\" >/dev/null 2>&1 && echo \"jump: ping=OK\" || echo \"jump: ping=FAIL\"
if command -v nc >/dev/null 2>&1; then
  nc -vz -w 2 \"\$H\" 22 >/dev/null 2>&1 && echo \"jump: tcp22=OK\" || echo \"jump: tcp22=FAIL\"
else
  echo \"jump: tcp22=? (nc missing)\"
fi
if [ -n \"\$IP\" ]; then
  ip neigh show to \"\$IP\" 2>/dev/null | head -n 1 | sed 's/^/jump: neigh=/' || true
fi
" 2>/dev/null || {
    echo "jump: ssh=FAIL"
  }
}

remote_facts_via_jump() {
  local host="$1"
  local target="${USER}@${host}"
  "${SSH[@]}" -J "$JUMP" "$target" "set -e
MAC_IP='$MAC_IP'
PI_PASSWORD='${PI_PASSWORD:-}'
echo \"remote: host=\$(hostname)\"
nmcli -g GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY dev show wlan0 2>/dev/null | sed 's/^/remote: nmcli: /' || true
iw dev wlan0 link 2>/dev/null | egrep 'Connected to|SSID:|freq:|signal:' | sed 's/^/remote: wifi: /' || true
nmcli -f IN-USE,BSSID,SSID,CHAN,FREQ,SIGNAL dev wifi list ifname wlan0 2>/dev/null | sed -n '1,6p' | sed 's/^/remote: wifi_list: /' || true
ip -4 -br addr show wlan0 2>/dev/null | sed 's/^/remote: addr: /' || true
ip route 2>/dev/null | sed -n '1,4p' | sed 's/^/remote: route: /' || true
if [ \"\$MAC_IP\" != 'UNKNOWN' ]; then
  ip route get \"\$MAC_IP\" 2>/dev/null | head -n 1 | sed 's/^/remote: route_to_mac: /' || true
  ip neigh show to \"\$MAC_IP\" 2>/dev/null | head -n 1 | sed 's/^/remote: neigh_mac: /' || true
  ping -c 1 -W 1 \"\$MAC_IP\" >/dev/null 2>&1 && echo 'remote: ping_mac=OK' || echo 'remote: ping_mac=FAIL'
  if command -v arping >/dev/null 2>&1; then
    if [ -n \"\$PI_PASSWORD\" ]; then
      echo \"\$PI_PASSWORD\" | sudo -S -v >/dev/null 2>&1 || true
    fi
    sudo arping -c 2 -I wlan0 \"\$MAC_IP\" 2>/dev/null | sed -n '1,3p' | sed 's/^/remote: arping_mac: /' || true
  fi
fi
ss -lntp 2>/dev/null | egrep ':(22)\\b' | head -n 1 | sed 's/^/remote: sshd_listen: /' || echo 'remote: sshd_listen=?'
" 2>/dev/null || return 1
}

echo "== CHIBA NET DIAG =="
echo "jump: $JUMP"
echo "jump_ip: ${JUMP_IP:-?}"
echo "mac: iface=$MAC_IFACE ip=$MAC_IP"
echo "mac: wifi:"
mac_wifi_info | sed 's/^/  /'
echo

echo "== jump reachability =="
if "${SSH[@]}" "$JUMP" "echo ok" 2>/dev/null | grep -q "^ok$"; then
  echo "jump: ok"
else
  echo "jump: FAIL (cannot ssh to jump host)"
  exit 2
fi
echo "jump: wifi:"
${SSH[@]} "$JUMP" "set -e
if command -v iw >/dev/null 2>&1; then
  iw dev wlan0 link 2>/dev/null | egrep 'Connected to|SSID:|freq:|signal:' || true
fi
if command -v nmcli >/dev/null 2>&1; then
  nmcli -g GENERAL.CONNECTION,IP4.ADDRESS dev show wlan0 2>/dev/null | sed 's/^/nmcli: /' || true
  nmcli -f IN-USE,BSSID,SSID,CHAN,FREQ,SIGNAL dev wifi list ifname wlan0 2>/dev/null | sed -n '1,6p' || true
fi
" | sed 's/^/  /' || true
echo

for host in "${TARGETS[@]}"; do
  echo "== $host =="
  probe_laptop "$host" | sed 's/^/  /'
  probe_from_jump "$host" | sed 's/^/  /'
  if remote_facts_via_jump "$host" | sed 's/^/  /'; then
    :
  else
    echo "  remote: ssh_via_jump=FAIL"
  fi
  echo
done
