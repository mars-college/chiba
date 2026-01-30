# Chiba v2 Architecture

Digital signage system for Raspberry Pi kiosks with central controller.

## Overview

Chiba is a multi-node digital signage system designed for:
- **Central control** of multiple Raspberry Pi displays
- **Content caching** with MD5 deduplication
- **Multiple content sources**: local files, URLs, YouTube, Google Drive, Eden collections
- **Real-time control** via WebSocket
- **Offline resilience** with local playback

## Package Structure

```
chiba/
├── packages/
│   ├── shared/          # @chiba/shared - Types, constants, utilities
│   ├── controller/      # @chiba/controller - Central controller server
│   ├── node/            # @chiba/node - Raspberry Pi node server
│   ├── player/          # @chiba/player - React player (kiosk display)
│   └── dashboard/       # @chiba/dashboard - React admin UI
├── scripts/             # Setup and deployment scripts
├── media/               # Cached content directory
└── old/                 # Archived v1 code (inert)
```

### @chiba/shared
- **Types**: Node, Content, Playback, Messages, API
- **Constants**: Ports, timeouts, intervals
- **Utils**: Logger with structured output
- **Test fixtures**: Sample data for testing

### @chiba/controller
- **HTTP API**: Node management, content library, playlists
- **WebSocket**: Real-time node connections (/ws/nodes), dashboard updates (/ws/dashboard)
- **SQLite DB**: Nodes, content, playlists, node-content mapping
- **Services**: NodeManager, ContentManager, WsManager

### @chiba/node
- **HTTP API**: Status, files, playback control, caching
- **WebSocket**: Player connection (/ws), controller connection
- **SQLite DB**: Cached content, config, playback history
- **Services**: Registration, ContentCache, YouTube, GDrive, Eden, Playback, Volume

### @chiba/player
- **React SPA**: Full-screen video/image/URL display
- **Components**: DebugScreen, VideoPlayer, ImageDisplay, IntroScreen, OfflineScreen
- **WebSocket**: Receives state from node server

### @chiba/dashboard
- **React SPA**: Admin control panel
- **Pages**: Nodes, NodeDetail, Content, Playlists, Settings
- **WebSocket**: Real-time updates from controller

## Data Flow

```
┌──────────────┐     HTTP/WS      ┌────────────────┐     HTTP/WS     ┌───────────────┐
│  Dashboard   │ ◄──────────────► │   Controller   │ ◄─────────────► │  Node (Pi)    │
│  (React)     │                  │   (Node.js)    │                 │  (Node.js)    │
└──────────────┘                  └────────────────┘                 └───────┬───────┘
                                                                             │ WS
                                                                     ┌───────▼───────┐
                                                                     │    Player     │
                                                                     │  (Chromium)   │
                                                                     └───────────────┘
```

1. **Dashboard → Controller**: Commands, playlist management
2. **Controller → Node**: Playback commands, preload requests
3. **Node → Controller**: Registration, heartbeats, state updates
4. **Node → Player**: Playback state via WebSocket
5. **Player → Node**: Ready, ended, error messages

## Key Patterns

### Logging
All components use structured logging:
```typescript
import { createLogger } from '@chiba/shared';
const logger = createLogger('component', 'module');

logger.info('Message', { key: 'value' });
logger.error('Failed', error, { context: 'data' });
```

Log format:
```
[2024-01-15T10:30:45.123Z] [INFO] [node:living-room] [cache] Downloaded video.mp4
```

### Content Caching
- Files cached by MD5 hash of content
- Filename: `{hash}.{ext}` (e.g., `a1b2c3d4.mp4`)
- Deduplication: same content = same hash = no re-download
- Metadata stored in SQLite

### Node Registration
1. Node boots, loads config from SQLite/env
2. Connects to controller via WebSocket
3. Sends `register` message with config and info
4. Controller stores node, assigns/confirms ID
5. Node sends heartbeats every 10 seconds

### Playback State Machine
```
off → video → (ended) → off
off → playlist → video/image → (ended) → next item → ...
off → url → (indefinite)
```

States include: mode, currentContent, playlist, index, loop, shuffle, paused, volume, imageDuration

## Database Schemas

### Controller (SQLite)
- `nodes`: Registered nodes with friendly names
- `node_status`: Connection state, playback, metrics
- `content`: Known content with hashes and metadata
- `playlists`: Saved playlists
- `node_content`: Which content is on which node

### Node (SQLite)
- `cached_content`: Local cache with hash, metadata
- `config`: Key-value configuration
- `playback_history`: Analytics
- `download_queue`: Background download queue
- `playlists`: Locally saved playlists (auto-saved when played)

## Environment Variables

### Controller
- `PORT`: HTTP port (default: 8080)
- `API_KEY`: Authentication key (shared with nodes)
- `DB_PATH`: SQLite database path
- `LOG_LEVEL`: debug/info/warn/error

### Node
- `PORT`: HTTP port (default: 8080)
- `API_KEY`: Authentication key (shared with controller)
- `EDEN_API_KEY`: Eden API key for collection sync (optional)
- `CONTROLLER_URL`: Controller WebSocket URL
- `NODE_ID`: Override auto-generated ID
- `NODE_NAME`: Friendly name for this node
- `DB_PATH`: SQLite database path
- `LOG_LEVEL`: debug/info/warn/error

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init-chiba.sh` | Generate API key, create .env, show deploy commands |
| `scripts/setup-node.sh` | Full Pi setup (packages, audio, kiosk, systemd) |
| `scripts/find-pis.sh` | Discover Pis by mDNS hostname |
| `scripts/upgrade-controller.sh` | Run ON controller to upgrade it |
| `scripts/setup-ngrok.sh` | Setup ngrok tunnel for public controller access (run ON controller) |
| `scripts/upgrade-node.sh` | Run ON a Pi node to upgrade it (soft/hard modes) |
| `scripts/rename.sh` | Rename a node via API (usage: `./rename.sh <host> <name>`) |
| `scripts/rotate.sh` | Rotate display via API (usage: `./rotate.sh <host> <0\|90\|180\|270>`) |
| `scripts/rotate-display.sh` | Run ON a Pi to rotate its own display locally |
| `scripts/network-watchdog.sh` | Network recovery daemon (runs as systemd service) |
| `scripts/auto-reboot.sh` | Toggle auto-reboot feature on/off (run ON Pi) |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Development mode (watch)
pnpm dev:controller  # Start controller
pnpm dev:node        # Start node
pnpm dev:player      # Start player dev server
pnpm dev:dashboard   # Start dashboard dev server
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/shared/src/types/` | All TypeScript interfaces |
| `packages/shared/src/constants.ts` | Ports, timeouts, intervals |
| `packages/shared/src/utils/logger.ts` | Structured logging |
| `packages/controller/src/server.ts` | Controller entry point |
| `packages/controller/src/db/schema.ts` | Controller DB schema |
| `packages/node/src/server.ts` | Node entry point |
| `packages/node/src/db/schema.ts` | Node DB schema |

## API Endpoints

### Controller (`/api/...`)
- `GET /api/nodes` - List all nodes
- `GET /api/nodes/:id` - Get node details
- `POST /api/nodes/register` - Node registration
- `POST /api/nodes/:id/play` - Start playback
- `POST /api/nodes/:id/stop` - Stop playback
- `POST /api/nodes/:id/cache` - Preload content

### Node API

**Public (no auth):**
- `GET /` - Service info
- `GET /health` - Health check
- `GET /status` - Full node status
- `GET /files` - Cached content list
- `GET /debug` - Debug screen data
- `GET /media/:filename` - Stream cached media

**Protected (requires API_KEY):**
- `POST /play` - Start playback (auto-detects source)
- `POST /stop` - Stop playback
- `POST /pause` - Pause playback
- `POST /resume` - Resume playback
- `POST /next` - Next playlist item
- `POST /previous` - Previous playlist item
- `POST /volume` - Set volume (0-100)
- `POST /loop` - Toggle loop mode
- `POST /shuffle` - Toggle shuffle mode for playlists
- `POST /image-duration` - Set image display duration (ms)
- `POST /append` - Append items to current playlist (or create new one)
- `POST /cache` - Cache content (doesn't play)
- `POST /clear-cache` - Delete all cached content
- `POST /exit-kiosk` - Exit kiosk mode (writes signal file for run-kiosk.sh)
- `POST /rename` - Rename node's friendly name (auto-updates dashboard via WebSocket)
- `POST /rotate` - Rotate display (0, 90, 180, 270 degrees; persists after reboot)

## Node API Details

### POST /play
Play content - auto-detects source type. No `type` parameter needed.

**Synchronous (immediate playback):**
```bash
# Play cached file - plays immediately
curl -X POST http://pi:8080/play -d '{"filename":"a1b2c3d4.mp4"}'

# Play non-media URL in iframe - plays immediately
curl -X POST http://pi:8080/play -d '{"url":"https://example.com/page"}'
```

**Async (returns taskId, plays when download completes):**
```bash
# Play YouTube - returns taskId, plays when downloaded
curl -X POST http://pi:8080/play -d '{"url":"https://youtube.com/watch?v=..."}'
# Response: {"success":true,"data":{"taskId":"youtube_abc...","status":"queued"}}

# Play Google Drive file - returns taskId, plays when downloaded
curl -X POST http://pi:8080/play -d '{"url":"https://drive.google.com/file/d/FILE_ID/view"}'
# Response: {"success":true,"data":{"taskId":"gdrive_abc...","status":"queued"}}

# Play media URL - returns taskId, plays when downloaded
curl -X POST http://pi:8080/play -d '{"url":"https://example.com/video.mp4"}'

# Play Eden collection - returns taskId, plays when synced
curl -X POST http://pi:8080/play -d '{"collectionId":"6526f380...","db":"PROD"}'
```

### POST /cache
Cache content without playing. Always async - returns immediately with taskId.

```bash
# Cache YouTube video
curl -X POST http://pi:8080/cache -d '{"url":"https://youtube.com/watch?v=..."}'
# Response: {"success":true,"data":{"taskId":"youtube_abc...","status":"queued","message":"Download queued"}}

# Cache Google Drive file
curl -X POST http://pi:8080/cache -d '{"url":"https://drive.google.com/file/d/FILE_ID/view"}'
# Response: {"success":true,"data":{"taskId":"gdrive_abc...","status":"queued","message":"Download queued"}}

# Cache media URL
curl -X POST http://pi:8080/cache -d '{"url":"https://example.com/video.mp4"}'
# Response: {"success":true,"data":{"taskId":"cache_abc...","status":"queued","message":"Download queued"}}

# Cache Eden collection
curl -X POST http://pi:8080/cache -d '{"collectionId":"6526f380...","db":"PROD"}'
# Response: {"success":true,"data":{"taskId":"eden_abc...","status":"queued","message":"Eden collection sync queued"}}
```

### POST /append
Append items to the currently playing playlist, or create a new playlist if none is active.

```bash
# Append items to current playlist
curl -X POST http://pi:8080/append -d '{
  "items": [
    {"id": "item-1", "content": {"type": "file", "filename": "abc123.mp4"}, "order": 0}
  ]
}'
# Response: {"success":true,"data":{"playlist":{...},"state":{...}}}

# Create new playlist if none playing
curl -X POST http://pi:8080/append -d '{
  "items": [...],
  "name": "My Playlist",
  "loop": true,
  "showIntros": false
}'
```

### POST /shuffle
Toggle shuffle mode for playlist playback.

```bash
curl -X POST http://pi:8080/shuffle -d '{"enabled":true}'
# Response: {"success":true,"data":{"shuffle":true}}
```

## Async Task System

Long-running operations (downloads, YouTube, Eden sync) use an async task queue:

1. **Request**: Client sends `/play` or `/cache` request
2. **Response**: Server returns immediately with `taskId` and `status: "queued"`
3. **Processing**: Node processes tasks sequentially in background
4. **Progress**: Node sends `download_progress` messages via WebSocket to controller
5. **Forwarding**: Controller forwards progress to dashboards as `task_progress`
6. **Completion**: On success, sends final progress with `status: "completed"` and `result`

### Task Progress Message (Node → Controller → Dashboard)
```typescript
{
  type: 'download_progress',
  taskId: 'youtube_abc123...',
  nodeId: 'pi-living-room',
  taskType: 'youtube' | 'cache' | 'eden' | 'gdrive',
  status: 'queued' | 'started' | 'downloading' | 'processing' | 'completed' | 'error',
  progress: 0-100,
  message?: 'Downloading...',
  result?: { filename, hash, sizeBytes, alreadyCached },
  error?: { code: 'DOWNLOAD_FAILED', message: 'Connection timeout' }
}
```

### Task Types
- `cache`: Generic URL download
- `youtube`: YouTube video via yt-dlp
- `gdrive`: Google Drive file via gdown (supports share links, direct links, etc.)
- `eden`: Eden collection sync or creation download

## WebSocket Protocols

### Controller ↔ Node (`/ws/nodes`)
- Node → Controller: `register`, `heartbeat`, `state`, `download_progress`, `content_cached`
- Controller → Node: `command`, `preload`, `ping`

### Node ↔ Player (`/ws`)
- Node → Player: `state`, `preload`, `download_progress`
- Player → Node: `ready`, `ended`, `error`

### Controller ↔ Dashboard (`/ws/dashboard`)
- Controller → Dashboard: `nodes`, `node_update`, `node_disconnected`, `task_progress`
- Dashboard → Controller: `command`, `subscribe`

## Authentication

Single shared `API_KEY` across controller and all nodes:
- Configured via environment variable or .env file
- Required for all POST endpoints on nodes
- Passed via `Authorization: Bearer <key>` header, `X-API-Key` header, or `?api_key=` query param

## Network Watchdog

The `chiba-network-watchdog` systemd service monitors network connectivity and auto-recovers from WiFi dropouts.

**Recovery levels (progressive):**
1. Restart WiFi interface
2. Reconnect via NetworkManager
3. Restart NetworkManager service
4. Full network stack restart (kill dhclient/wpa_supplicant, restart services)
5. Auto-reboot (if enabled and node is idle)

**View logs:**
```bash
journalctl -u chiba-network-watchdog -f          # Follow live
journalctl -u chiba-network-watchdog -n 100      # Last 100 lines
journalctl -u chiba-network-watchdog --since "1 hour ago"
```

**Enable persistent logs** (survive reboots - recommended for debugging):
```bash
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald
```

### Auto-Reboot Feature

When enabled, the watchdog will reboot the Pi as a last resort if:
- Network has been down for ~10 minutes (20 consecutive failures)
- All software recovery attempts have failed
- Node is idle (not playing content)

**Safeguards:**
- Only reboots if node is idle (checks `/status` endpoint)
- 1 hour minimum cooldown between reboots
- Max 3 consecutive reboots before giving up (prevents reboot loops)
- Reboot counter resets when network recovers

**Toggle auto-reboot (run ON the Pi):**
```bash
./chiba/scripts/auto-reboot.sh on      # Enable
./chiba/scripts/auto-reboot.sh off     # Disable
./chiba/scripts/auto-reboot.sh         # Check status
./chiba/scripts/auto-reboot.sh reset   # Reset counter after manual fix
```

**Deploy to nodes:**
```bash
# Copy updated scripts
scp scripts/network-watchdog.sh scripts/auto-reboot.sh pi@<pi-ip>:~/chiba/scripts/

# Enable on node
ssh pi@<pi-ip> "~/chiba/scripts/auto-reboot.sh on && sudo systemctl restart chiba-network-watchdog"
```

## Govee Lights

The controller manages Govee LED lights via UDP LAN protocol (port 4003).

### Current Lights

| ID | Name | IP | Device ID |
|----|------|-----|-----------|
| `a` | Auditorium | 100.128.0.144 | 0B:DC:DB:C3:43:86:79:2F |
| `ge1` | Gallery East 1 | 100.128.0.254 | 37:C4:DA:C3:40:46:20:39 |
| `ge2` | Gallery East 2 | 100.128.0.145 | 0C:F1:DB:48:45:86:1B:61 |
| `gw1` | Gallery West 1 | 100.128.0.255 | 12:D9:DD:6E:06:06:5D:8C |
| `gw2` | Gallery West 2 | 100.128.0.149 | 0E:97:DB:48:45:86:0D:3A |
| `mm` | Mimos | 100.128.0.148 | 0C:9B:DD:6E:04:06:56:27 |
| `t` | Terrace | 100.128.0.146 | 0D:89:DD:6E:03:C6:7D:5F |

### Updating Light IP Addresses

When light IPs change (e.g., after network changes), update BOTH locations:

**1. Config file** (`packages/shared/src/config/lights.json`):
```json
{ "id": "ge1", "name": "Gallery East 1", "ip": "NEW_IP_HERE", "deviceId": "..." }
```

**2. Database** (run on controller):
```bash
DB_PATH="/home/gene/chiba/packages/controller/data/controller.db"
sqlite3 "$DB_PATH" "UPDATE lights SET ip_address = 'NEW_IP' WHERE id = 'ge1';"
```

**3. Copy config to dist and restart:**
```bash
cp packages/shared/src/config/lights.json packages/shared/dist/config/lights.json
sudo systemctl restart chiba-controller
```

### Discovery & Import

If multicast discovery fails (common across subnets/Tailscale), use manual import:

```bash
# Import discovered lights via API
curl -X POST http://localhost:24422/api/lights/import \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "lights": [
      {"ip": "100.128.0.144", "deviceId": "0B:DC:DB:C3:43:86:79:2F", "sku": "H6061"}
    ]
  }'
```

### Light Control API

```bash
# Control by ID or name (case-insensitive)
curl -X POST http://localhost:24422/api/lights/ge1/control \
  -H "X-API-Key: $API_KEY" \
  -d '{"power": true, "brightness": 80, "hue": 0, "saturation": 100}'

# Control all lights
curl -X POST http://localhost:24422/api/lights/all/control \
  -H "X-API-Key: $API_KEY" \
  -d '{"power": true, "brightness": 50}'
```
