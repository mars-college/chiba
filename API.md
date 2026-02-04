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
      "uptime": 3600,
      "displayRotation": 0
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
    "controllerConnected": true,
    "wsClients": 1
  }
}
```

#### GET /files
List all cached content files.

**Response:**
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "hash": "a1b2c3d4",
        "filename": "a1b2c3d4.mp4",
        "name": "My Video",
        "type": "video",
        "sizeBytes": 52428800,
        "cachedAt": 1704067200000
      }
    ],
    "totalBytes": 52428800,
    "count": 1
  }
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
Stream a cached media file. Used by the player to load content. Supports HTTP range requests for video seeking.

**Response:** Binary file stream with appropriate Content-Type header.

#### GET /player
Serves the player web application (SPA).

---

### Protected Endpoints (Require Auth)

#### POST /play
Play content. Auto-detects source type from provided parameters. Downloads content if needed (async) or plays immediately if already cached (sync).

**Request Body Options:**

```bash
# Play cached file by filename (sync - plays immediately)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"filename": "a1b2c3d4.mp4"}'

# Play YouTube URL (async - returns taskId, plays when downloaded)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'

# Play Google Drive file (async - returns taskId)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://drive.google.com/file/d/FILE_ID/view"}'

# Play direct media URL (async - returns taskId)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://example.com/video.mp4"}'

# Play Eden collection as playlist (async - returns taskId)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"collectionId": "6526f38042a1043421aa28e8", "db": "PROD"}'

# Play Eden single creation (async - returns taskId)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"creationId": "abc123", "db": "PROD"}'

# Play non-media URL in iframe (sync - no download needed)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://example.com/dashboard"}'

# Play a playlist object directly (sync)
curl -X POST http://node:8080/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"playlist": {...}, "startIndex": 0}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `filename` | string | Cached file to play (sync) |
| `url` | string | URL to play (YouTube, Drive, direct media, or webpage) |
| `collectionId` | string | Eden collection ID |
| `creationId` | string | Eden creation ID |
| `db` | string | Eden database: `PROD` or `STAGE` (default: `PROD`) |
| `loop` | boolean | Loop playback (preserves current setting if not specified) |
| `showIntro` | boolean | Show intro screen before content |
| `name` | string | Optional friendly name for cached content |
| `playlist` | object | Playlist object to play directly |
| `startIndex` | number | Starting index for playlist (default: 0) |
| `content` | object | Content object to play directly |

**Synchronous Response (cached file, iframe URL):**
```json
{
  "success": true,
  "data": {
    "state": { ... }
  }
}
```

**Asynchronous Response (downloads required):**
```json
{
  "success": true,
  "data": {
    "taskId": "youtube_abc123...",
    "status": "queued",
    "message": "YouTube download queued, will play when complete"
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
Cache content without playing. Always async - returns immediately with taskId.

```bash
# Cache YouTube video
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'

# Cache Google Drive file
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://drive.google.com/file/d/FILE_ID/view"}'

# Cache media URL
curl -X POST http://node:8080/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://example.com/video.mp4"}'

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
    "taskId": "youtube_abc123...",
    "status": "queued",
    "message": "Download queued"
  }
}
```

#### POST /append
Append items to the current playlist, or create a new playlist if none is active.

```bash
# Append items to current playlist
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

#### GET /kiosk-url
Get the current kiosk URL override (empty string means default player).

```bash
curl http://node:8080/kiosk-url
```

**Response:**
```json
{ "success": true, "data": { "url": "http://controller:8787/?screenId=pi-01" } }
```

#### POST /kiosk-url
Set the kiosk URL override and restart the kiosk.

```bash
curl -X POST http://node:8080/kiosk-url \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url":"http://controller:8787/?screenId=pi-01"}'
```

**Response:**
```json
{ "success": true, "data": { "url": "http://controller:8787/?screenId=pi-01", "restartQueued": true } }
```

#### POST /kiosk-restart
Restart the kiosk without changing the URL.

```bash
curl -X POST http://node:8080/kiosk-restart \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{ "success": true, "data": { "restartQueued": true } }
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
  "name": "chiba-controller",
  "version": "0.1.0",
  "endpoints": [
    "GET /api/info",
    "GET /health",
    "GET /api/nodes",
    ...
  ]
}
```

#### GET /health
Health check endpoint.

**Response:**
```json
{ "status": "ok", "uptime": 86400 }
```

#### GET /api/config
Get controller configuration (used by dashboard).

**Response:**
```json
{
  "apiKey": "your-api-key",
  "version": "0.1.0"
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
          "port": 8080,
          "version": "0.1.0",
          "uptime": 3600,
          "displayRotation": 0
        },
        "connected": true,
        "lastSeen": 1704067200000,
        "playbackState": { ... },
        "cachedContent": [...],
        "diskUsage": { ... },
        "hardware": { ... }
      }
    ]
  }
}
```

#### GET /api/nodes/:id
Get specific node details. Accepts node ID or friendly name.

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
  "data": [
    {
      "id": "uuid",
      "hash": "a1b2c3d4",
      "filename": "video.mp4",
      "name": "My Video",
      "originalUrl": "https://youtube.com/...",
      "source": { "type": "youtube", "url": "..." },
      "type": "video",
      "sizeBytes": 52428800,
      "duration": 180,
      "metadata": { ... },
      "createdAt": 1704067200000
    }
  ]
}
```

#### GET /api/playlists
List all playlists.

**Response:**
```json
{
  "success": true,
  "data": [
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
```

#### GET /api/playlists/:id
Get a single playlist by ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Morning Rotation",
    "items": [
      {
        "id": "item-uuid",
        "sourceType": "youtube",
        "sourceData": { "url": "https://..." },
        "name": "Video Title",
        "duration": null,
        "order": 0
      }
    ],
    "loop": true,
    "showIntros": false,
    "introDuration": 3000,
    "createdAt": 1704067200000,
    "updatedAt": 1704067200000
  }
}
```

#### GET /uploads/:filename
Serve uploaded media files. Supports HTTP range requests for video streaming.

**Response:** Binary file stream with appropriate Content-Type header.

---

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

**Response:**
```json
{
  "success": true,
  "data": {
    "collection": { ... },
    "creations": [...]
  }
}
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

#### POST /api/upload
Upload a file directly to the controller.

```bash
curl -X POST http://controller:8080/api/upload \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@video.mp4"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "hash": "a1b2c3d4...",
    "filename": "a1b2c3d4.mp4",
    "originalName": "video.mp4",
    "contentType": "video",
    "sizeBytes": 52428800,
    "url": "http://controller:8080/uploads/a1b2c3d4.mp4"
  }
}
```

#### POST /api/content
Add content to library.

```bash
# Add YouTube URL
curl -X POST http://controller:8080/api/content \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/watch?v=...", "name": "My Video"}'

# Add Eden creation URL
curl -X POST http://controller:8080/api/content \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://app.eden.art/creations/abc123"}'

# Add Eden collection URL (creates playlist automatically)
curl -X POST http://controller:8080/api/content \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://app.eden.art/collection/6526f380...", "name": "My Collection"}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL to add (YouTube, Eden, or direct) |
| `name` | string | Optional display name |
| `description` | string | Optional description |
| `author` | string | Optional author name |

**Response (single content):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "hash": "a1b2c3d4",
    "filename": "video.mp4",
    "name": "My Video",
    "sourceType": "youtube",
    "originalUrl": "https://youtube.com/...",
    "metadata": { ... }
  }
}
```

**Response (Eden collection):**
```json
{
  "success": true,
  "data": {
    "type": "collection",
    "collectionId": "6526f380...",
    "collectionName": "Art Collection",
    "playlistId": "uuid",
    "playlistName": "My Collection",
    "contentCount": 15,
    "contentIds": ["uuid1", "uuid2", ...]
  }
}
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
      {"creationId": "abc123"},
      {"filename": "cached-video.mp4"}
    ],
    "loop": true,
    "showIntros": false,
    "introDuration": 3000,
    "targetNodes": ["node-uuid-1", "node-uuid-2"]
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

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Playlist name (required) |
| `items` | array | Array of playlist items |
| `loop` | boolean | Loop playback (default: true) |
| `showIntros` | boolean | Show intro screens (default: true) |
| `introDuration` | number | Intro duration in ms (default: 3000) |
| `targetNodes` | array | Node IDs to pre-cache content on |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Morning Rotation",
    "items": [...],
    "loop": true,
    "showIntros": false,
    "introDuration": 3000,
    "createdAt": 1704067200000,
    "updatedAt": 1704067200000
  }
}
```

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

**Response:**
```json
{
  "success": true,
  "data": {
    "addedItems": [...],
    "totalItems": 10
  }
}
```

#### DELETE /api/playlists/:id/items/:index
Remove item from playlist by index.

```bash
curl -X DELETE http://controller:8080/api/playlists/uuid-here/items/0 \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{ "success": true, "message": "Item removed", "remainingItems": 9 }
```

#### POST /api/playlists/:id/play
Play playlist on a specific node.

```bash
curl -X POST http://controller:8080/api/playlists/uuid-here/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"nodeId": "node-uuid", "startIndex": 0}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `nodeId` | string | Target node ID (required) |
| `startIndex` | number | Starting item index (default: 0) |

#### POST /api/playlists/:id/cache
Cache playlist content on specified nodes.

```bash
curl -X POST http://controller:8080/api/playlists/uuid-here/cache \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"nodeIds": ["node-uuid-1", "node-uuid-2"]}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `nodeIds` | array | Array of node IDs to cache content on (required) |

**Response:**
```json
{
  "success": true,
  "data": {
    "playlistId": "uuid",
    "results": {
      "node-uuid-1": { "status": "success" },
      "node-uuid-2": { "status": "partial", "errors": ["..."] }
    }
  }
}
```

#### POST /api/nodes/register
HTTP registration endpoint for nodes (used when WebSocket isn't available).

```bash
curl -X POST http://controller:8080/api/nodes/register \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"id": "node-uuid", "name": "living-room", "port": 8080}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "node-uuid",
    "name": "living-room",
    "apiKey": "shared-api-key"
  }
}
```

#### POST /api/nodes/:id/:action
Proxy any command to a specific node. Node can be referenced by ID or friendly name.

```bash
# Play on node
curl -X POST http://controller:8080/api/nodes/living-room/play \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url": "https://youtube.com/..."}'

# Stop node
curl -X POST http://controller:8080/api/nodes/node-uuid/stop \
  -H "Authorization: Bearer $API_KEY"

# Set volume on node
curl -X POST http://controller:8080/api/nodes/node-uuid/volume \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"level": 50}'

# Rename node
curl -X POST http://controller:8080/api/nodes/node-uuid/rename \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"name": "Kitchen Display"}'

# Rotate node display
curl -X POST http://controller:8080/api/nodes/node-uuid/rotate \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"rotation": 90}'
```

Any node endpoint can be proxied through the controller using this pattern.

---

## Lights API

The controller manages smart lights (currently Wizlights).

### Public Endpoints

#### GET /api/lights
Get all registered lights with their current states.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Living Room Lamp",
      "ipAddress": "192.168.1.50",
      "port": 38899,
      "deviceType": "ESP25_SHRGB_01",
      "createdAt": 1704067200000,
      "updatedAt": 1704067200000,
      "state": {
        "lightId": "uuid",
        "power": true,
        "hue": 240,
        "saturation": 100,
        "brightness": 80,
        "updatedAt": 1704067200000
      },
      "reachable": true
    }
  ]
}
```

#### GET /api/presets
Get all light presets (both predefined and user-created).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Warm Evening",
      "isPredefined": false,
      "settings": [
        {
          "lightId": "*",
          "power": true,
          "hue": 30,
          "saturation": 80,
          "brightness": 60
        }
      ],
      "createdAt": 1704067200000,
      "updatedAt": 1704067200000
    }
  ]
}
```

---

### Protected Endpoints (Require Auth)

#### POST /api/lights/:id/control
Control a single light.

```bash
curl -X POST http://controller:8080/api/lights/uuid/control \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"power": true, "brightness": 80, "hue": 240, "saturation": 100}'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `power` | boolean | Turn light on/off |
| `brightness` | number | Brightness 0-100 |
| `hue` | number | Color hue 0-360 |
| `saturation` | number | Color saturation 0-100 |

**Response:**
```json
{
  "success": true,
  "data": {
    "lightId": "uuid",
    "state": {
      "power": true,
      "hue": 240,
      "saturation": 100,
      "brightness": 80
    }
  }
}
```

#### POST /api/lights/all/control
Control all lights at once.

```bash
curl -X POST http://controller:8080/api/lights/all/control \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"power": false}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      { "lightId": "uuid1", "success": true },
      { "lightId": "uuid2", "success": true }
    ]
  }
}
```

#### POST /api/presets
Create a new light preset.

```bash
curl -X POST http://controller:8080/api/presets \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Movie Mode",
    "settings": [
      {"lightId": "*", "power": true, "brightness": 20, "hue": 30, "saturation": 80}
    ]
  }'
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Preset name (required) |
| `settings` | array | Array of light settings (required) |

**Light Setting Object:**
| Field | Type | Description |
|-------|------|-------------|
| `lightId` | string | Light ID or `*` for all lights |
| `power` | boolean | Turn light on/off |
| `brightness` | number | Brightness 0-100 |
| `hue` | number | Color hue 0-360 |
| `saturation` | number | Color saturation 0-100 |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Movie Mode",
    "isPredefined": false,
    "settings": [...],
    "createdAt": 1704067200000,
    "updatedAt": 1704067200000
  }
}
```

#### POST /api/presets/:id/apply
Apply a preset to lights.

```bash
curl -X POST http://controller:8080/api/presets/uuid/apply \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "presetId": "uuid",
    "results": [
      { "lightId": "uuid1", "success": true },
      { "lightId": "uuid2", "success": true }
    ]
  }
}
```

#### DELETE /api/presets/:id
Delete a user-created preset. Cannot delete predefined presets.

```bash
curl -X DELETE http://controller:8080/api/presets/uuid \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{ "success": true, "message": "Preset deleted" }
```

---

## WebSocket Protocols

### Node ↔ Player (`/ws`)

Player connects to node's WebSocket to receive playback state.

**Node → Player Messages:**
```json
{"type": "state", "playback": {...}}
{"type": "preload", "content": {...}}
{"type": "download_progress", "taskId": "...", "status": "...", "progress": 50}
```

**Player → Node Messages:**
```json
{"type": "ready"}
{"type": "ended"}
{"type": "intro_complete"}
{"type": "error", "error": "..."}
```

### Controller ↔ Node (`/ws/nodes`)

Nodes connect to controller for registration and heartbeat.

**Node → Controller:**
```json
{"type": "register", "config": {...}, "info": {...}}
{"type": "heartbeat", "status": {...}}
{"type": "state", "playback": {...}}
{"type": "pong", "timestamp": 1704067200000}
{"type": "download_progress", "taskId": "...", "status": "...", "progress": 50}
{"type": "content_cached", "content": {...}}
```

**Controller → Node:**
```json
{"type": "command", "command": {"action": "play", ...}}
{"type": "preload", "content": [...]}
{"type": "ping", "timestamp": 1704067200000}
{"type": "config", "config": {...}}
```

### Controller ↔ Dashboard (`/ws/dashboard`)

Dashboard connects to controller for real-time updates.

**Controller → Dashboard:**
```json
{"type": "nodes", "nodes": [...]}
{"type": "node_update", "nodeId": "...", "status": {...}}
{"type": "node_disconnected", "nodeId": "..."}
{"type": "task_progress", "nodeId": "...", "task": {...}}
```

**Dashboard → Controller:**
```json
{"type": "subscribe"}
{"type": "command", "nodeId": "...", "command": {"action": "...", ...}}
```

---

## Async Task System

Long-running operations (downloads, YouTube, Eden sync) use an async task queue.

### Task Flow
1. **Request**: Client sends `/play` or `/cache` request
2. **Response**: Server returns immediately with `taskId` and `status: "queued"`
3. **Processing**: Node processes tasks sequentially in background
4. **Progress**: Node sends `download_progress` messages via WebSocket to controller
5. **Forwarding**: Controller forwards progress to dashboards as `task_progress`
6. **Completion**: On success, sends final progress with `status: "completed"` and `result`

### Task Progress Message
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
| Type | Description |
|------|-------------|
| `cache` | Generic URL download |
| `youtube` | YouTube video via yt-dlp |
| `gdrive` | Google Drive file via gdown |
| `eden` | Eden collection sync or creation download |

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
  shuffledOrder?: number[];  // Shuffle order indices
  paused: boolean;
  volume: number;            // 0-100
  imageDuration: number;     // milliseconds (default: 10000)
  position?: number;         // current position in seconds
  introMetadata?: ContentMetadata;
}
```

---

## Content Types

Content is automatically detected from the source:

| Source | Detection | Type |
|--------|-----------|------|
| `youtube.com`, `youtu.be` | URL pattern | YouTube video |
| `drive.google.com` | URL pattern | Google Drive file |
| `app.eden.art/creations/...` | URL pattern | Eden creation |
| `app.eden.art/collection/...` | URL pattern | Eden collection |
| `.mp4`, `.webm`, `.mov`, `.mkv` | File extension | Video |
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
- `403` - Forbidden (e.g., cannot delete predefined presets)
- `404` - Not found (node, content, or playlist doesn't exist)
- `409` - Conflict (e.g., preset name already exists)
- `500` - Internal server error
- `502` - Bad gateway (node unreachable when proxying)
