#!/bin/bash
# Controller Client - Send commands to Pis via central controller
#
# Usage:
#   ./controller-client.sh discover
#   ./controller-client.sh --kiosk mars01.local status
#   ./controller-client.sh --kiosk mars01.local file video.mp4
#   ./controller-client.sh --kiosk mars02.local youtube "https://youtube.com/..."
#
# Environment variables:
#   CONTROLLER_URL - Controller base URL (default: http://localhost:8080)
#   API_KEY - API key for authentication

CONTROLLER="${CONTROLLER_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-}"
KIOSK=""

# Parse arguments
while [ $# -gt 0 ]; do
    case $1 in
        --kiosk)
            KIOSK="$2"
            shift 2
            ;;
        --kiosk=*)
            KIOSK="${1#*=}"
            shift
            ;;
        --controller)
            CONTROLLER="$2"
            shift 2
            ;;
        --controller=*)
            CONTROLLER="${1#*=}"
            shift
            ;;
        --key)
            API_KEY="$2"
            shift 2
            ;;
        --key=*)
            API_KEY="${1#*=}"
            shift
            ;;
        --help|-h)
            echo "Controller Client - Send commands to Pis via central controller"
            echo ""
            echo "Usage: $0 [OPTIONS] COMMAND [ARGS]"
            echo ""
            echo "Options:"
            echo "  --kiosk HOSTNAME    Target Pi hostname (e.g., mars01.local)"
            echo "  --controller URL    Controller URL (default: \$CONTROLLER_URL or http://localhost:8080)"
            echo "  --key KEY           API key (default: \$API_KEY)"
            echo ""
            echo "Commands (no --kiosk required):"
            echo "  discover            Find all Pis on network"
            echo "  info                Show controller info"
            echo ""
            echo "Commands (require --kiosk):"
            echo "  status              Get kiosk status"
            echo "  files               List media files"
            echo "  volume [LEVEL]      Get or set volume (0-10)"
            echo "  file FILENAME       Play a file"
            echo "  url URL             Show website"
            echo "  off                 Turn off display"
            echo "  youtube URL         Download and play YouTube video"
            echo "  cache URL           Download and cache URL"
            echo "  cache_play URL      Download URL and play immediately"
            echo "  playlist F1 F2 ...  Play multiple files as playlist"
            echo "  next                Next in playlist"
            echo "  previous            Previous in playlist"
            echo "  pause               Pause playback"
            echo "  resume              Resume playback"
            echo "  restart             Restart current video/playlist"
            echo ""
            echo "Examples:"
            echo "  $0 discover"
            echo "  $0 --kiosk mars01.local status"
            echo "  $0 --kiosk mars01.local file video.mp4"
            echo "  $0 --kiosk mars01.local youtube 'https://youtube.com/watch?v=xxx'"
            echo "  $0 --kiosk mars01.local volume 7"
            echo ""
            echo "Environment variables:"
            echo "  CONTROLLER_URL      Default controller URL"
            echo "  API_KEY             Default API key"
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

COMMAND="$1"
shift 2>/dev/null || true

# Helper function for GET requests
get() {
    endpoint="$1"
    if [ -n "$KIOSK" ]; then
        url="$CONTROLLER$endpoint?kiosk=$KIOSK"
    else
        url="$CONTROLLER$endpoint"
    fi

    echo "GET $url" >&2
    curl -s "$url" | jq . 2>/dev/null || cat
}

# Helper function for POST requests
post() {
    endpoint="$1"
    data="$2"

    echo "POST $CONTROLLER$endpoint" >&2

    if [ -n "$API_KEY" ]; then
        curl -s -X POST \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "$data" "$CONTROLLER$endpoint" | jq . 2>/dev/null || cat
    else
        curl -s -X POST \
            -H "Content-Type: application/json" \
            -d "$data" "$CONTROLLER$endpoint" | jq . 2>/dev/null || cat
    fi
}

# Require kiosk for most commands
require_kiosk() {
    if [ -z "$KIOSK" ]; then
        echo "Error: --kiosk is required for this command" >&2
        echo "Usage: $0 --kiosk HOSTNAME $COMMAND ..." >&2
        exit 1
    fi
}

case "$COMMAND" in
    discover)
        get /discover
        ;;
    info|"")
        get /
        ;;
    status)
        require_kiosk
        get /status
        ;;
    files)
        require_kiosk
        get /files
        ;;
    volume)
        require_kiosk
        if [ -n "$1" ]; then
            post /volume "{\"kiosk\": \"$KIOSK\", \"level\": $1}"
        else
            get /volume
        fi
        ;;
    file)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: filename required" >&2
            exit 1
        fi
        post /file "{\"kiosk\": \"$KIOSK\", \"file\": \"$1\"}"
        ;;
    url)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: URL required" >&2
            exit 1
        fi
        post /url "{\"kiosk\": \"$KIOSK\", \"url\": \"$1\"}"
        ;;
    off)
        require_kiosk
        post /off "{\"kiosk\": \"$KIOSK\"}"
        ;;
    youtube)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: YouTube URL required" >&2
            exit 1
        fi
        echo "Downloading YouTube video (this may take a while)..." >&2
        post /youtube_and_play "{\"kiosk\": \"$KIOSK\", \"url\": \"$1\"}"
        ;;
    cache)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: URL required" >&2
            exit 1
        fi
        post /cache "{\"kiosk\": \"$KIOSK\", \"url\": \"$1\"}"
        ;;
    cache_play)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: URL required" >&2
            exit 1
        fi
        post /cache_and_play "{\"kiosk\": \"$KIOSK\", \"url\": \"$1\"}"
        ;;
    playlist)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: at least one file required" >&2
            exit 1
        fi
        # Build items array from arguments
        items="["
        first=true
        for file in "$@"; do
            if [ "$first" = true ]; then
                first=false
            else
                items="$items,"
            fi
            items="$items{\"file\": \"$file\"}"
        done
        items="$items]"
        post /playlist "{\"kiosk\": \"$KIOSK\", \"items\": $items}"
        ;;
    next)
        require_kiosk
        post /next "{\"kiosk\": \"$KIOSK\"}"
        ;;
    previous|prev)
        require_kiosk
        post /previous "{\"kiosk\": \"$KIOSK\"}"
        ;;
    pause)
        require_kiosk
        post /pause "{\"kiosk\": \"$KIOSK\"}"
        ;;
    resume)
        require_kiosk
        post /resume "{\"kiosk\": \"$KIOSK\"}"
        ;;
    restart)
        require_kiosk
        post /restart "{\"kiosk\": \"$KIOSK\"}"
        ;;
    sync)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: collection ID required" >&2
            exit 1
        fi
        db="${2:-PROD}"
        post /sync "{\"kiosk\": \"$KIOSK\", \"collectionId\": \"$1\", \"db\": \"$db\"}"
        ;;
    sync_play)
        require_kiosk
        if [ -z "$1" ]; then
            echo "Error: collection ID required" >&2
            exit 1
        fi
        db="${2:-PROD}"
        echo "Syncing collection (this may take a while)..." >&2
        post /sync_and_play "{\"kiosk\": \"$KIOSK\", \"collectionId\": \"$1\", \"db\": \"$db\"}"
        ;;
    *)
        echo "Unknown command: $COMMAND" >&2
        echo "Use --help for usage information" >&2
        exit 1
        ;;
esac
