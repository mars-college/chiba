#!/usr/bin/env bash
set -euo pipefail

LOG_PREFIX="[cable3-network-watchdog]"
STATE_DIR="/var/lib/chiba-cable3"
STATE_FILE="${STATE_DIR}/network-watchdog.state"
LOCK_FILE="/run/cable3-network-watchdog.lock"

# Connectivity policy:
# - Gateway reachability is required.
# - Internet reachability is optional and disabled by default to support
#   installations that intentionally run local-only during WAN outages.
CHECK_INTERNET="${CHECK_INTERNET:-0}"
INTERNET_TARGETS="${INTERNET_TARGETS:-1.1.1.1 8.8.8.8 9.9.9.9}"
PING_TIMEOUT="${PING_TIMEOUT:-2}"

# Recovery policy:
# - Track consecutive failures.
# - Escalate recovery level every FAILURE_THRESHOLD failures.
# - Rate-limit recovery actions to avoid thrash loops.
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
RECOVERY_COOLDOWN_SEC="${RECOVERY_COOLDOWN_SEC:-120}"

failure_count=0
last_recovery_epoch=0

log() {
  echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

save_state() {
  local tmp
  tmp="$(mktemp)"
  cat >"${tmp}" <<EOF
failure_count=${failure_count}
last_recovery_epoch=${last_recovery_epoch}
EOF
  mkdir -p "${STATE_DIR}"
  mv "${tmp}" "${STATE_FILE}"
}

load_state() {
  if [[ ! -f "${STATE_FILE}" ]]; then
    return 0
  fi

  while IFS='=' read -r key value; do
    case "${key}" in
      failure_count)
        if [[ "${value}" =~ ^[0-9]+$ ]]; then
          failure_count="${value}"
        fi
        ;;
      last_recovery_epoch)
        if [[ "${value}" =~ ^[0-9]+$ ]]; then
          last_recovery_epoch="${value}"
        fi
        ;;
    esac
  done < "${STATE_FILE}"
}

default_iface() {
  ip route show default 2>/dev/null | awk 'NR==1 {print $5}'
}

default_gateway() {
  ip route show default 2>/dev/null | awk 'NR==1 {print $3}'
}

has_global_ipv4() {
  local iface="$1"
  ip -4 addr show dev "${iface}" scope global 2>/dev/null | grep -q 'inet '
}

ping_ok() {
  local target="$1"
  ping -c 1 -W "${PING_TIMEOUT}" "${target}" >/dev/null 2>&1
}

disable_wifi_powersave() {
  local iface="$1"
  [[ "${iface}" == wlan* ]] || return 0

  if has_cmd iw; then
    iw dev "${iface}" set power_save off >/dev/null 2>&1 || true
  fi
  if has_cmd iwconfig; then
    iwconfig "${iface}" power off >/dev/null 2>&1 || true
  fi
}

recover_reconnect_nm() {
  local iface="$1"
  has_cmd nmcli || return 1

  log "Recovery L1: reconnect via NetworkManager on ${iface}"
  nmcli device reapply "${iface}" >/dev/null 2>&1 || true
  nmcli device connect "${iface}" >/dev/null 2>&1 || true
  return 0
}

recover_cycle_iface() {
  local iface="$1"
  log "Recovery L2: cycle interface ${iface}"
  ip link set "${iface}" down >/dev/null 2>&1 || true
  sleep 2
  ip link set "${iface}" up >/dev/null 2>&1 || true
  sleep 5

  if has_cmd nmcli; then
    nmcli device reapply "${iface}" >/dev/null 2>&1 || true
    nmcli device connect "${iface}" >/dev/null 2>&1 || true
  fi
  if has_cmd wpa_cli && [[ "${iface}" == wlan* ]]; then
    wpa_cli -i "${iface}" reconfigure >/dev/null 2>&1 || true
  fi
  return 0
}

recover_restart_services() {
  log "Recovery L3: restart network services"
  systemctl restart NetworkManager.service >/dev/null 2>&1 || true
  systemctl restart wpa_supplicant.service >/dev/null 2>&1 || true
  systemctl restart dhcpcd.service >/dev/null 2>&1 || true
  systemctl restart networking.service >/dev/null 2>&1 || true
  sleep 8
  return 0
}

network_healthy() {
  local iface="$1"
  local gateway="$2"

  if ! has_global_ipv4 "${iface}"; then
    log "Unhealthy: ${iface} has no global IPv4"
    return 1
  fi

  if [[ -n "${gateway}" ]] && ! ping_ok "${gateway}"; then
    log "Unhealthy: cannot reach gateway ${gateway} via ${iface}"
    return 1
  fi

  if [[ "${CHECK_INTERNET}" == "1" ]]; then
    local target
    for target in ${INTERNET_TARGETS}; do
      if ping_ok "${target}"; then
        return 0
      fi
    done
    log "Unhealthy: internet checks failed (${INTERNET_TARGETS})"
    return 1
  fi

  return 0
}

attempt_recovery() {
  local iface="$1"
  local now stage
  now="$(date +%s)"

  if (( now - last_recovery_epoch < RECOVERY_COOLDOWN_SEC )); then
    log "Recovery cooldown active ($((now - last_recovery_epoch))s < ${RECOVERY_COOLDOWN_SEC}s)"
    return 0
  fi

  stage=$(( (failure_count - FAILURE_THRESHOLD) / FAILURE_THRESHOLD ))
  if (( stage < 0 )); then
    stage=0
  fi

  case "${stage}" in
    0)
      recover_reconnect_nm "${iface}" || recover_cycle_iface "${iface}" || true
      ;;
    1)
      recover_cycle_iface "${iface}" || recover_restart_services || true
      ;;
    *)
      recover_restart_services || true
      recover_reconnect_nm "${iface}" || true
      ;;
  esac

  last_recovery_epoch="${now}"
  save_state
}

main() {
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    exit 0
  fi

  load_state

  local iface gateway
  iface="$(default_iface || true)"
  gateway="$(default_gateway || true)"

  if [[ -z "${iface}" ]]; then
    log "Unhealthy: no default route interface"
    failure_count=$((failure_count + 1))
    save_state
    return 0
  fi

  disable_wifi_powersave "${iface}"

  if network_healthy "${iface}" "${gateway}"; then
    if (( failure_count > 0 )); then
      log "Recovered after ${failure_count} failures (iface=${iface}, gateway=${gateway:-none})"
      failure_count=0
      last_recovery_epoch=0
      save_state
    fi
    return 0
  fi

  failure_count=$((failure_count + 1))
  log "Failure count=${failure_count} (iface=${iface}, gateway=${gateway:-none}, internet_check=${CHECK_INTERNET})"
  save_state

  if (( failure_count >= FAILURE_THRESHOLD )); then
    attempt_recovery "${iface}"
  fi
}

main "$@"
