#!/bin/bash
# Quick health check for a set of Raspberry Pis reachable over SSH.
#
# Examples:
#   PI_PASSWORD=interact ./scripts/pis/healthcheck.sh mars15.local mars19.local
#   printf "%s\n" mars15.local mars19.local | PI_PASSWORD=interact ./scripts/pis/healthcheck.sh --stdin
#   PI_PASSWORD=interact ./scripts/pis/healthcheck.sh --auto mars 32
#
# Notes:
# - If PI_PASSWORD is set and sshpass is installed, this runs non-interactively.
# - Otherwise, SSH will prompt for passwords/host keys as usual (parallelism forced to 1).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

USER_NAME="pi"
TIMEOUT_SECS=5
PARALLEL=1
READ_STDIN=0
AUTO_PREFIX=""
AUTO_MAX=""
RANGE_PREFIX=""
RANGE_MAX=""
PASSWORD_ENV="PI_PASSWORD"
FORCE_NO_SSHPASS=0
DEBUG=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pis/healthcheck.sh [hosts...] [options]

Options:
  --user pi                 SSH username (default: pi)
  --timeout N               SSH ConnectTimeout in seconds (default: 5)
  --parallel N              Number of concurrent SSH checks (default: 1)
  --stdin                   Read hosts (whitespace/newline separated) from stdin
  --auto <prefix> <max>     Discover reachable hosts via ./scripts/find-pis.sh (example: --auto mars 32)
  --range <prefix> <max>    Generate hosts without ping discovery (example: --range mars 32)
  --password-env VAR        Read password from env var (default: PI_PASSWORD)
  --no-sshpass              Never use sshpass (always prompt)
  --debug                   Print decision info (no secrets)
  --help                    Show this help

Output columns:
  host  uptime  load  disk(/)  mem_avail  temp  chiba_node  api
EOF
}

is_pos_int() {
  case "${1:-}" in
    ''|*[!0-9]*)
      return 1
      ;;
    *)
      [ "$1" -gt 0 ] 2>/dev/null
      ;;
  esac
}

HOST_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --user)
      USER_NAME="${2:-}"
      shift 2
      ;;
    --user=*)
      USER_NAME="${1#*=}"
      shift
      ;;
    --timeout)
      TIMEOUT_SECS="${2:-}"
      shift 2
      ;;
    --timeout=*)
      TIMEOUT_SECS="${1#*=}"
      shift
      ;;
    --parallel)
      PARALLEL="${2:-}"
      shift 2
      ;;
    --parallel=*)
      PARALLEL="${1#*=}"
      shift
      ;;
    --stdin)
      READ_STDIN=1
      shift
      ;;
    --auto)
      AUTO_PREFIX="${2:-}"
      AUTO_MAX="${3:-}"
      shift 3
      ;;
    --range)
      RANGE_PREFIX="${2:-}"
      RANGE_MAX="${3:-}"
      shift 3
      ;;
    --password-env)
      PASSWORD_ENV="${2:-}"
      shift 2
      ;;
    --password-env=*)
      PASSWORD_ENV="${1#*=}"
      shift
      ;;
    --no-sshpass)
      FORCE_NO_SSHPASS=1
      shift
      ;;
    --debug)
      DEBUG=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      HOST_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! is_pos_int "$TIMEOUT_SECS"; then
  echo "ERROR: --timeout must be a positive integer (got: $TIMEOUT_SECS)" >&2
  exit 2
fi

if ! is_pos_int "$PARALLEL"; then
  echo "ERROR: --parallel must be a positive integer (got: $PARALLEL)" >&2
  exit 2
fi

HOSTS_RAW=""

if [ -n "$AUTO_PREFIX" ] || [ -n "$AUTO_MAX" ]; then
  if [ -z "$AUTO_PREFIX" ] || [ -z "$AUTO_MAX" ]; then
    echo "ERROR: --auto requires <prefix> and <max> (example: --auto mars 32)" >&2
    exit 2
  fi
  if [ ! -x "$REPO_ROOT/scripts/find-pis.sh" ]; then
    echo "ERROR: missing executable: $REPO_ROOT/scripts/find-pis.sh" >&2
    exit 2
  fi
  # find-pis.sh prints: "<hostname> <ip>"
  HOSTS_RAW="$("$REPO_ROOT/scripts/find-pis.sh" "$AUTO_PREFIX" "$AUTO_MAX" | awk '{print $1}')"
fi

if [ -n "$RANGE_PREFIX" ] || [ -n "$RANGE_MAX" ]; then
  if [ -z "$RANGE_PREFIX" ] || [ -z "$RANGE_MAX" ]; then
    echo "ERROR: --range requires <prefix> and <max> (example: --range mars 32)" >&2
    exit 2
  fi
  if ! is_pos_int "$RANGE_MAX"; then
    echo "ERROR: --range <max> must be a positive integer (got: $RANGE_MAX)" >&2
    exit 2
  fi
  # Always 2-digit padding to match existing naming convention (mars01..mars32).
  # (BSD seq -w pads to width of max, so for max=32 we'd get 01..32, but for max=3 we'd get 1..3.
  # Always force %02d here.)
  for i in $(seq 1 "$RANGE_MAX"); do
    HOSTS_RAW="${HOSTS_RAW}
${RANGE_PREFIX}$(printf '%02d' "$i").local"
  done
fi

if [ $READ_STDIN -eq 1 ]; then
  # Accept whitespace/newline separated hostnames.
  HOSTS_RAW="${HOSTS_RAW}
$(cat)"
fi

if [ "${#HOST_ARGS[@]}" -gt 0 ]; then
  HOSTS_RAW="${HOSTS_RAW}
${HOST_ARGS[*]}"
fi

HOSTS="$(printf "%s\n" "$HOSTS_RAW" \
  | tr ' \t' '\n' \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
  | sed '/^$/d' \
  | awk '!seen[$0]++' \
)"

if [ -z "$HOSTS" ]; then
  usage >&2
  exit 2
fi

# Resolve password (if any) without failing on unset env var.
# Do NOT assign PI_PASSWORD until after we read the env var, because the env var
# may itself be named PI_PASSWORD.
PASSWORD_VALUE=""
if [ -n "$PASSWORD_ENV" ]; then
  # Indirect expansion reads an env var without spawning a process.
  # If PASSWORD_ENV isn't a valid identifier, ignore it.
  if [[ "$PASSWORD_ENV" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    PASSWORD_VALUE="${!PASSWORD_ENV-}"
  fi
fi
PI_PASSWORD="$PASSWORD_VALUE"

SSHPASS_BIN=""
if [ "$FORCE_NO_SSHPASS" -ne 1 ]; then
  SSHPASS_BIN="$(command -v sshpass 2>/dev/null || true)"
  if [ -z "$SSHPASS_BIN" ] && [ -x /opt/homebrew/bin/sshpass ]; then
    SSHPASS_BIN="/opt/homebrew/bin/sshpass"
  fi
  if [ -z "$SSHPASS_BIN" ] && [ -x /usr/local/bin/sshpass ]; then
    SSHPASS_BIN="/usr/local/bin/sshpass"
  fi
fi

SSH_BASE=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout="$TIMEOUT_SECS" -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=1)
if [ -n "$PI_PASSWORD" ] && [ -n "$SSHPASS_BIN" ]; then
  # Prefer SSHPASS env var so the password doesn't end up in the process list args.
  export SSHPASS="$PI_PASSWORD"
  SSH_BASE=("$SSHPASS_BIN" -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout="$TIMEOUT_SECS" -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=1)
fi

if [ "$DEBUG" -eq 1 ]; then
  if [ -n "$PI_PASSWORD" ]; then
    echo "debug: password env '$PASSWORD_ENV' is set" >&2
  else
    echo "debug: password env '$PASSWORD_ENV' is NOT set/empty" >&2
  fi
  if [ -n "$SSHPASS_BIN" ]; then
    echo "debug: sshpass found at: $SSHPASS_BIN" >&2
  else
    echo "debug: sshpass not found (or disabled)" >&2
  fi
  echo "debug: ssh base: ${SSH_BASE[*]}" >&2
fi

# If we're going to prompt (no sshpass), parallel checks will fight over stdin/tty.
if [ "${SSH_BASE[0]}" = "ssh" ] && [ "$PARALLEL" -ne 1 ]; then
  echo "Note: forcing --parallel 1 because sshpass is not active (interactive prompts)." >&2
  PARALLEL=1
fi

check_one() {
  local host="$1"

  # Add .local if hostname doesn't contain a dot (not IP or FQDN)
  if [[ ! "$host" =~ \. ]]; then
    host="${host}.local"
  fi

  local target="${USER_NAME}@${host}"

  local out
  local errfile
  errfile="$(mktemp -t chiba-ssh-err.XXXXXX 2>/dev/null || mktemp)"
  if ! out="$("${SSH_BASE[@]}" "$target" bash -s 2>"$errfile" <<'EOF'
set -u

host="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "?")"

uptime_p="$(uptime -p 2>/dev/null || true)"
if [ -z "$uptime_p" ]; then
  uptime_p="$(uptime 2>/dev/null | sed -E 's/[[:space:]]+/ /g' || true)"
fi

load="$(LC_ALL=C uptime 2>/dev/null | awk -F'load average: ' 'NF>1{gsub(/[[:space:]]/, "", $2); print $2}')"
disk="$(df -P / 2>/dev/null | awk 'NR==2{print $5}')"

mem_avail="$(free -m 2>/dev/null | awk '/^Mem:/{print $7 "MB"}')"
if [ -z "$mem_avail" ]; then
  mem_avail="$(awk '/^MemAvailable:/{printf("%.0fMB", $2/1024)}' /proc/meminfo 2>/dev/null || true)"
fi

temp="$(vcgencmd measure_temp 2>/dev/null | sed -E "s/^temp=([0-9.]+).*/\\1C/")"
if [ -z "$temp" ]; then
  raw="$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || true)"
  if [ -n "$raw" ]; then
    temp="$(awk -v r="$raw" 'BEGIN{printf("%.1fC", r/1000)}')"
  fi
fi

chiba_node="$(systemctl is-active chiba-node 2>/dev/null || true)"
if [ -z "$chiba_node" ]; then
  chiba_node="?"
fi

api="n/a"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 2 http://localhost:8080/status >/dev/null 2>&1; then
    api="ok"
  else
    api="fail"
  fi
fi

printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
  "$host" "${uptime_p:-?}" "${load:-?}" "${disk:-?}" "${mem_avail:-?}" "${temp:-?}" "${chiba_node:-?}" "${api:-?}"
EOF
  )"; then
    local err
    err="$(tr -d '\r' <"$errfile" | head -n 3 | tr '\n' ' ' | sed -e 's/[[:space:]]\\+/ /g' -e 's/[[:space:]]*$//')"
    rm -f "$errfile" 2>/dev/null || true

    local reason="SSH_FAIL"
    case "$err" in
      *"Permission denied"*|*"Authentication failed"*)
        reason="SSH_AUTH"
        ;;
      *"Connection refused"*)
        reason="SSH_REFUSED"
        ;;
      *"Operation timed out"*|*"Connection timed out"*|*"Timed out"*)
        reason="SSH_TIMEOUT"
        ;;
      *"No route to host"*)
        reason="SSH_NOROUTE"
        ;;
      *"Name or service not known"*|*"Could not resolve hostname"*|*"nodename nor servname provided"*)
        reason="SSH_NODNS"
        ;;
    esac

    printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$host" "$reason" "?" "?" "?" "?" "?" "?"
    return 0
  fi

  rm -f "$errfile" 2>/dev/null || true
  printf "%s\n" "$out"
}

tmpdir="$(mktemp -d 2>/dev/null || mktemp -d -t chiba-pi-health)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "host" "uptime" "load" "disk(/)" "mem_avail" "temp" "chiba_node" "api"

i=0
pids=()
for host in $HOSTS; do
  i=$((i + 1))
  idx="$(printf "%04d" "$i")"
  (
    check_one "$host"
  ) >"$tmpdir/$idx.out" 2>"$tmpdir/$idx.err" &

  pids+=("$!")

  # Basic concurrency gate compatible with bash 3.2
  while [ "${#pids[@]}" -ge "$PARALLEL" ]; do
    wait "${pids[0]}" 2>/dev/null || true
    pids=("${pids[@]:1}")
  done
done

if [ "${#pids[@]}" -gt 0 ]; then
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
fi

if ls "$tmpdir"/*.out >/dev/null 2>&1; then
  for f in "$tmpdir"/*.out; do
    cat "$f"
  done
fi
