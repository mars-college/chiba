# Chiba REST API Reference

Complete API documentation for Chiba digital signage system.

## Authentication

Protected endpoints require authentication via one of:
- `Authorization: Bearer <API_KEY>` header
- `X-API-Key: <API_KEY>` header
- `?api_key=<API_KEY>` query parameter

The API key is shared between controller and all nodes, configured via `API_KEY` environment variable.

---

## Node API

The node server runs on each Raspberry Pi (default port 8080).

### Public Endpoints (No Auth)

#### GET /
Service information.

**Response:**
```json
{
  "name": "chiba-node",
  "version": "0.1.0",
  "friendlyName": "living-room",
  "nodeId": "uuid-here",
  "uptime": 3600
}
```

#### GET /health
Health check endpoint.

**Response:**
```json
{ "status": "ok" }
```

#### GET /status
Full node status including playback state, cache info, and hardware metrics.

**Response:**
```json
{
  "success": true,
  "data": {
    "node": {
      "id": "uuid",
      "friendlyName": "living-room",
      "hostname": "mars01.local",
      "ip": "192.168.1.101",
      "port": 8080,
      "version": "0.1.0",
      "uptime": 3600
    },
    "playback": {
      "mode": "video",
      "playlistIndex": 0,
      "loop": true,
      "shuffle": false,
      "paused": false,
      "volume": 100,
      "imageDuration": 10000,
      "currentContent": { ... }
    },
    "cache": {
      "itemCount": 15,
      "totalBytes": 1073741824
    },
    "hardware": {
      "cpuUsage": 25.5,
      "memoryUsage": 45.2,
      "temperature": 52.3
    }
  }
}
```

#### GET /files
List all cached content files.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "hash": "a1b2c3d4",
      "filename": "a1b2c3d4.mp4",
      "type": "video",
      "sizeBytes": 52428800,
      "metadata": { "title": "My Video" },
      "createdAt": 1704067200000
    }
  ]
}
```

#### GET /debug
Debug screen data for the player overlay.

**Response:**
```json
{
  "nodeName": "living-room",
  "nodeId": "uuid",
  "ipAddress": "192.168.1.101",
  "networkStatus": "online",
  "controllerStatus": "online",
  "content": [
    { "filename": "abc123.mp4", "sizeBytes": 52428800, "type": "video", "name": "My Video" }
  ],
  "totalCacheSize": 1073741824,
  "playlists": [
    { "id": "uuid", "name": "My Playlist", "itemCount": 5, "loop": true, "createdAt": 1704067200000, "updatedAt": 1704067200000 }
  ],
  "currentPlaylist": {
    "id": "uuid",
    "name": "My Playlist",
    "currentIndex": 2,
    "totalItems": 5
  }
}
```

#### GET /media/:filename
Stream a cached media file. Used by the player to load content.

**Response:** Binary file stream with appropriate Content-Type header.

---

### Protected Endpoints (Require Auth)

#### POST /play
Play content. Auto-detects source type from provided parameters.

**Request Body Options:**

```bash
# Play cached file by filename
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"filename": "a1b2c3d4.mp4"}'

# Play URL (auto-detects YouTube)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'

# Play direct media URL
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://example.com/video.mp4"}'

# Play Eden collection as playlist
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"collectionId": "6526f38042a1043421aa28e8", "db": "PROD", "loop": true}'

# Play Eden single creation
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"creationId": "abc123", "db": "PROD"}'

# Play non-media URL in iframe
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://example.com/dashboard"}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `filename` | string | Cached file to play |
| `url` | string | URL to play (YouTube, direct media, or webpage) |
| `collectionId` | string | Eden collection ID |
| `creationId` | string | Eden creation ID |
| `db` | string | Eden database: `PROD` or `STAGE` (default: `PROD`) |
| `loop` | boolean | Loop playback (default: `true` for single, playlist's setting for collections) |
| `name` | string | Optional friendly name for cached content |

**Response:**
```json
{
  "success": true,
  "data": {
    "state": { ... },
    "sync": {
      "total": 7,
      "downloaded": 5,
      "skipped": 2,
      "failed": 0
    }
  }
}
```

#### POST /stop
Stop playback and return to off mode.

```bash
curl -X POST http://node:8080/stop \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{ "success": true, "data": { "state": { "mode": "off", ... } } }
```

#### POST /pause
Pause current playback.

```bash
curl -X POST http://node:8080/pause \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /resume
Resume paused playback.

```bash
curl -X POST http://node:8080/resume \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /next
Skip to next item in playlist.

```bash
curl -X POST http://node:8080/next \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /previous
Go to previous item in playlist.

```bash
curl -X POST http://node:8080/previous \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /volume
Set volume level.

```bash
curl -X POST http://node:8080/volume \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"level": 75}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | number | Volume level 0-100 |

**Response:**
```json
{ "success": true, "data": { "volume": 75 } }
```

#### POST /loop
Set loop mode.

```bash
curl -X POST http://node:8080/loop \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"enabled": true}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `enabled` | boolean | Enable/disable loop (omit to toggle) |

**Response:**
```json
{ "success": true, "data": { "loop": true } }
```

#### POST /shuffle
Set shuffle mode for playlist playback.

```bash
curl -X POST http://node:8080/shuffle \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"enabled": true}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `enabled` | boolean | Enable/disable shuffle (omit to toggle) |

**Response:**
```json
{ "success": true, "data": { "shuffle": true } }
```

#### POST /image-duration
Set how long images display in playlists before auto-advancing.

```bash
curl -X POST http://node:8080/image-duration \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"duration": 5000}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `duration` | number | Duration in milliseconds (minimum: 1000) |

**Response:**
```json
{ "success": true, "data": { "imageDuration": 5000 } }
```

#### POST /cache
Cache content without playing. Useful for pre-loading content.

```bash
# Cache URL
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://example.com/video.mp4"}'

# Cache YouTube video
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'

# Cache Eden collection
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"collectionId": "6526f380...", "db": "PROD"}'

# Cache Eden creation
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"creationId": "abc123", "db": "PROD"}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "content": {
      "hash": "a1b2c3d4",
      "filename": "a1b2c3d4.mp4",
      "type": "video",
      "sizeBytes": 52428800
    }
  }
}
```

#### POST /append
Append items to the current playlist, or create a new playlist if none is active.

```bash
# Append to current playlist
curl -X POST http://node:8080/append \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "items": [
      {"id": "item-1", "content": {"type": "file", "filename": "abc123.mp4"}, "order": 0}
    ]
  }'

# Create new playlist (when none is playing)
curl -X POST http://node:8080/append \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "items": [...],
    "name": "My Playlist",
    "loop": true,
    "showIntros": false
  }'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `items` | array | Array of PlaylistItem objects (required) |
| `name` | string | Playlist name (only used when creating new) |
| `loop` | boolean | Loop setting (only used when creating new) |
| `showIntros` | boolean | Show intro screens (only used when creating new) |

**Response:**
```json
{
  "success": true,
  "data": {
    "playlist": { ... },
    "state": { ... }
  }
}
```

#### POST /clear-cache
Delete all cached content.

```bash
curl -X POST http://node:8080/clear-cache \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{ "success": true, "data": { "deletedCount": 15, "freedBytes": 1073741824 } }
```

#### POST /exit-kiosk
Exit kiosk mode on the Pi.

```bash
curl -X POST http://node:8080/exit-kiosk \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{ "success": true, "message": "Kiosk killed" }
```

#### POST /rename
Rename the node's friendly name.

```bash
curl -X POST http://node:8080/rename \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"name": "Living Room"}'
```

**Response:**
```json
{ "success": true, "data": { "oldName": "unnamed-node", "newName": "Living Room" } }
```

#### POST /rotate
Rotate the display. Applies immediately and persists across reboots.

```bash
curl -X POST http://node:8080/rotate \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"rotation": 90}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `rotation` | number | Rotation in degrees: 0, 90, 180, or 270 |

**Response:**
```json
{ "success": true, "data": { "oldRotation": 0, "newRotation": 90, "appliedImmediately": true } }
```

---

## Controller API

The controller server manages multiple nodes (default port 8080).

### Public Endpoints

#### GET /api/info
Controller information.

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "chiba-controller",
    "version": "0.1.0",
    "uptime": 86400,
    "nodeCount": 5
  }
}
```

#### GET /api/nodes
List all connected nodes.

**Response:**
```json
{
  "success": true,
  "data": {
    "nodes": [
      {
        "node": {
          "id": "uuid",
          "friendlyName": "living-room",
          "hostname": "mars01.local",
          "ip": "192.168.1.101",
          "port": 8080
        },
        "connected": true,
        "lastSeen": 1704067200000,
        "playbackState": { ... }
      }
    ]
  }
}
```

#### GET /api/nodes/:id
Get specific node details.

**Response:**
```json
{
  "success": true,
  "data": {
    "node": { ... }
  }
}
```

#### GET /api/content
List content library.

**Response:**
```json
{
  "success": true,
  "data": {
    "content": [
      {
        "id": "uuid",
        "hash": "a1b2c3d4",
        "filename": "video.mp4",
        "name": "My Video",
        "sourceType": "youtube",
        "originalUrl": "https://youtube.com/...",
        "createdAt": 1704067200000
      }
    ]
  }
}
```

#### GET /api/playlists
List all playlists.

**Response:**
```json
{
  "success": true,
  "data": {
    "playlists": [
      {
        "id": "uuid",
        "name": "Morning Rotation",
        "items": [...],
        "loop": true,
        "showIntros": false,
        "introDuration": 3000,
        "createdAt": 1704067200000,
        "updatedAt": 1704067200000
      }
    ]
  }
}
```

### Eden Proxy Endpoints

#### GET /api/eden/creation/:id
Get Eden creation metadata.

```bash
curl "http://controller:8080/api/eden/creation/abc123?db=PROD"
```

#### GET /api/eden/collection/:id
Get Eden collection with creations.

```bash
curl "http://controller:8080/api/eden/collection/6526f380...?db=PROD"
```

#### GET /api/eden/parse?url=...
Parse an Eden URL to extract type and ID.

```bash
curl "http://controller:8080/api/eden/parse?url=https://app.eden.art/creations/abc123"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "type": "creation",
    "id": "abc123",
    "db": "PROD"
  }
}
```

---

### Protected Endpoints (Require Auth)

#### POST /api/content
Add content to library.

```bash
curl -X POST http://controller:8080/api/content \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"type": "youtube", "url": "https://youtube.com/...", "name": "My Video"}'
```

#### DELETE /api/content/:id
Remove content from library.

```bash
curl -X DELETE http://controller:8080/api/content/uuid-here \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /api/playlists
Create a new playlist.

```bash
curl -X POST http://controller:8080/api/playlists \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Morning Rotation",
    "items": [
      {"url": "https://youtube.com/watch?v=..."},
      {"collectionId": "6526f380...", "db": "PROD"},
      {"creationId": "abc123"}
    ],
    "loop": true,
    "showIntros": false,
    "introDuration": 3000
  }'
```

**Item Types:**
| Field | Description |
|-------|-------------|
| `url` | Direct URL, YouTube URL, or Eden URL |
| `creationId` | Eden creation ID |
| `collectionId` | Eden collection ID |
| `filename` | Local cached filename |
| `name` | Display name for item |
| `duration` | Override duration (ms) |
| `db` | Eden database (`PROD`/`STAGE`) |

#### PUT /api/playlists/:id
Update a playlist.

```bash
curl -X PUT http://controller:8080/api/playlists/uuid-here \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"name": "New Name", "loop": false}'
```

**Updatable Fields:**
- `name` - Playlist name
- `items` - Replace all items
- `loop` - Loop setting
- `showIntros` - Show intro screens
- `introDuration` - Intro screen duration (ms)

#### DELETE /api/playlists/:id
Delete a playlist.

```bash
curl -X DELETE http://controller:8080/api/playlists/uuid-here \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /api/playlists/:id/items
Add items to existing playlist.

```bash
curl -X POST http://controller:8080/api/playlists/uuid-here/items \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"items": [{"url": "https://..."}]}'
```

#### DELETE /api/playlists/:id/items/:index
Remove item from playlist by index.

```bash
curl -X DELETE http://controller:8080/api/playlists/uuid-here/items/0 \
  -H "Authorization: Bearer $API_KEY"
```

#### POST /api/playlists/:id/play
Play playlist on a specific node.

```bash
curl -X POST http://controller:8080/api/playlists/uuid-here/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"nodeId": "node-uuid", "startIndex": 0}'
```

#### POST /api/nodes/:id/:action
Proxy any command to a specific node.

```bash
# Play on node
curl -X POST http://controller:8080/api/nodes/node-uuid/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/..."}'

# Stop node
curl -X POST http://controller:8080/api/nodes/node-uuid/stop \
  -H "Authorization: Bearer $API_KEY"

# Set volume on node
curl -X POST http://controller:8080/api/nodes/node-uuid/volume \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"level": 50}'
```

Any node endpoint can be proxied through the controller using this pattern.

---

## WebSocket Protocols

### Node ↔ Player (`/ws`)

Player connects to node's WebSocket to receive playback state.

**Node → Player Messages:**
```json
{"type": "state", "playback": {...}}
{"type": "preload", "content": {...}}
```

**Player → Node Messages:**
```json
{"type": "ready"}
{"type": "ended"}
{"type": "error", "message": "..."}
```

### Controller ↔ Node (`/ws/nodes`)

Nodes connect to controller for registration and heartbeat.

**Node → Controller:**
```json
{"type": "register", "config": {...}, "info": {...}}
{"type": "heartbeat", "state": {...}}
{"type": "state", "playback": {...}}
```

**Controller → Node:**
```json
{"type": "command", "action": "play", "payload": {...}}
{"type": "preload", "content": {...}}
{"type": "ping"}
```

### Controller ↔ Dashboard (`/ws/dashboard`)

Dashboard connects to controller for real-time updates.

**Controller → Dashboard:**
```json
{"type": "nodes", "nodes": [...]}
{"type": "node_update", "nodeId": "...", "status": {...}}
{"type": "node_disconnected", "nodeId": "..."}
```

**Dashboard → Controller:**
```json
{"type": "subscribe"}
{"type": "command", "nodeId": "...", "action": "...", "payload": {...}}
```

---

## Playback State

The playback state object is used throughout the system:

```typescript
interface PlaybackState {
  mode: 'off' | 'video' | 'image' | 'url' | 'intro';
  currentContent?: Content;
  currentUrl?: string;
  playlist?: Playlist;
  playlistIndex: number;
  loop: boolean;
  shuffle: boolean;
  shuffledOrder?: number[]; // Shuffle order indices
  paused: boolean;
  volume: number;           // 0-100
  imageDuration: number;    // milliseconds (default: 10000)
  position?: number;        // current position in seconds
  introMetadata?: ContentMetadata;
}
```

---

## Content Types

Content is automatically detected from the source:

| Source | Detection | Type |
|--------|-----------|------|
| `youtube.com`, `youtu.be` | URL pattern | YouTube video |
| `app.eden.art/creations/...` | URL pattern | Eden creation |
| `app.eden.art/collections/...` | URL pattern | Eden collection |
| `.mp4`, `.webm`, `.mov` | File extension | Video |
| `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` | File extension | Image |
| Other URLs | Default | Iframe/webpage |

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

Common HTTP status codes:
- `400` - Bad request (missing/invalid parameters)
- `401` - Unauthorized (missing/invalid API key)
- `404` - Not found (node, content, or playlist doesn't exist)
- `500` - Internal server error
- `502` - Bad gateway (node unreachable when proxying)
