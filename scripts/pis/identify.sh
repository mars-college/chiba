#!/bin/bash
# Flash a full-screen identifier on a Pi kiosk, then restore the prior URL.
#
# Usage:
#   ./scripts/pis/identify.sh <hostname> [--seconds N] [--user pi] [--port 9900] [--install-dir /home/pi/chiba] [--detach|--wait] [--no-kill]
#
# Examples:
#   ./scripts/pis/identify.sh mars07.local
#   ./scripts/pis/identify.sh mars07 --seconds 300
#   ./scripts/pis/identify.sh 192.168.1.50 --user pi

set -euo pipefail

SECONDS=120
USER_NAME="pi"
PORT=9900
INSTALL_DIR="/home/pi/chiba"
RUN_MODE="wait"
KILL_CAGE=1

usage() {
  echo "Usage: $0 <hostname> [--seconds N] [--user pi] [--port 9900] [--install-dir /home/pi/chiba] [--detach|--wait] [--no-kill]"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

HOST="$1"
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --seconds)
      SECONDS="$2"
      shift 2
      ;;
    --seconds=*)
      SECONDS="${1#*=}"
      shift
      ;;
    --user)
      USER_NAME="$2"
      shift 2
      ;;
    --user=*)
      USER_NAME="${1#*=}"
      shift
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --install-dir=*)
      INSTALL_DIR="${1#*=}"
      shift
      ;;
    --detach)
      RUN_MODE="detach"
      shift
      ;;
    --wait)
      RUN_MODE="wait"
      shift
      ;;
    --no-kill)
      KILL_CAGE=0
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      ;;
  esac
done

# Add .local if hostname doesn't contain a dot (not IP or FQDN)
if [[ ! "$HOST" =~ \. ]]; then
  HOST="${HOST}.local"
fi

SSH_BASE=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
SSH_TARGET="${USER_NAME}@${HOST}"

"${SSH_BASE[@]}" "$SSH_TARGET" bash -s -- "$SECONDS" "$PORT" "$INSTALL_DIR" "$RUN_MODE" "$KILL_CAGE" <<'EOF'
set -euo pipefail

SECONDS="$1"
PORT="$2"
INSTALL_DIR="$3"
RUN_MODE="$4"
KILL_CAGE="$5"

RUNNER="/tmp/chiba-identify-runner.sh"
cat > "$RUNNER" <<'RUNNER'
#!/bin/bash
set -euo pipefail

SECONDS="$1"
PORT="$2"
INSTALL_DIR="$3"

PREV_URL=$(cat "$INSTALL_DIR/.kiosk-url" 2>/dev/null || echo "http://localhost:8080/player")
HOST=$(hostname)
IP=$(hostname -I | awk '{print $1}')

HTML=/tmp/chiba-identify.html
cat > "$HTML" <<HTML
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Identify</title>
<style>
  html,body{margin:0;height:100%;font-family:Arial,Helvetica,sans-serif;}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;
       color:#fff;font-weight:700;text-align:center;font-size:8vw;transition:background .4s;}
  .small{font-size:3vw;font-weight:400;margin-top:2vh;}
</style>
</head>
<body>
  <div>${HOST}</div>
  <div class="small">${IP}</div>
  <script>
    const colors=["#ff0048","#0015ff","#00c853","#ffb300"];
    let i=0;setInterval(()=>{document.body.style.background=colors[i++%colors.length];},600);
  </script>
</body>
</html>
HTML

for _ in 1 2 3; do
  if ss -ltn "sport = :$PORT" | grep -q LISTEN; then
    PORT=$((PORT + 1))
  else
    break
  fi
done

python3 -m http.server "$PORT" --directory /tmp >/tmp/chiba-identify.log 2>&1 &
PID=$!

IDENTIFY_URL="http://localhost:$PORT/chiba-identify.html"

API_SET=0
if curl -sS -X POST http://localhost:8080/kiosk-url \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$IDENTIFY_URL\"}" >/dev/null 2>&1; then
  API_SET=1
fi

if [ "$API_SET" -eq 0 ]; then
  echo "$IDENTIFY_URL" > "$INSTALL_DIR/.kiosk-url"
fi

touch /tmp/chiba-kiosk-restart
if [ "$KILL_CAGE" -eq 1 ]; then
  pkill -9 cage 2>/dev/null || true
  pkill -9 -f "cage.*chromium" 2>/dev/null || true
  pkill -9 chromium 2>/dev/null || true
  pkill -9 chromium-browser 2>/dev/null || true
fi

sleep "$SECONDS"

if [ -n "$PREV_URL" ]; then
  if ! curl -sS -X POST http://localhost:8080/kiosk-url \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$PREV_URL\"}" >/dev/null 2>&1; then
    echo "$PREV_URL" > "$INSTALL_DIR/.kiosk-url"
  fi
fi
touch /tmp/chiba-kiosk-restart
if [ "$KILL_CAGE" -eq 1 ]; then
  pkill -9 cage 2>/dev/null || true
  pkill -9 -f "cage.*chromium" 2>/dev/null || true
  pkill -9 chromium 2>/dev/null || true
  pkill -9 chromium-browser 2>/dev/null || true
fi
kill "$PID" 2>/dev/null || true
RUNNER

chmod +x "$RUNNER"

if [ "$RUN_MODE" = "detach" ]; then
  nohup "$RUNNER" "$SECONDS" "$PORT" "$INSTALL_DIR" >/tmp/chiba-identify-run.log 2>&1 &
  echo "Identify started for ${SECONDS}s"
else
  "$RUNNER" "$SECONDS" "$PORT" "$INSTALL_DIR"
fi
EOF

echo "Identify triggered on $HOST"
