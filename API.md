# Chiba Kiosk API Reference

This document describes the HTTP API for controlling Chiba digital signage kiosks remotely. Use this to build tools, automations, or integrations.

## Base URL

Each kiosk has a unique public URL via ngrok tunnel:
```
https://<kiosk-domain>.ngrok-free.app
```

## Authentication

All POST endpoints require authentication. Include your API key in one of these ways:

### Option 1: Authorization Header (Recommended)
```bash
curl -X POST https://kiosk.ngrok-free.app/file \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"file": "video.mp4"}'
```

### Option 2: X-API-Key Header
```bash
curl -X POST https://kiosk.ngrok-free.app/file \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"file": "video.mp4"}'
```

### Option 3: Query Parameter (Less Secure)
```bash
curl -X POST "https://kiosk.ngrok-free.app/file?api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"file": "video.mp4"}'
```

**Public endpoints** (no auth required): `GET /`, `GET /status`, `GET /files`, `GET /player`, `GET /media/*`, `GET /assets/*`

## Endpoints

### GET /status

Get current kiosk state.

**Response:**
```json
{
  "mode": "video",
  "file": "example.mp4",
  "url": null,
  "playlist": null,
  "playlistIndex": 0,
  "loop": true,
  "wsClients": 1
}
```

**Mode values:**
- `"off"` - Display is black/idle
- `"video"` - Playing a single video (looping)
- `"playlist"` - Playing through a list of videos/images
- `"url"` - Showing a website in iframe

---

### GET /files

List all media files available on the kiosk.

**Response:**
```json
{
  "files": ["example.mp4", "a1b2c3d4.mp4", "image.jpg"]
}
```

---

### POST /file

Play a single video file (loops continuously).

**Request:**
```json
{
  "file": "example.mp4"
}
```

**Response:**
```json
{
  "status": "ok",
  "mode": "video",
  "file": "example.mp4",
  "url": null
}
```

**Error (file not found):**
```json
{
  "error": "File not found: nonexistent.mp4"
}
```

---

### POST /off

Turn off the display (black screen).

**Request:** Empty body or `{}`

**Response:**
```json
{
  "status": "ok",
  "mode": "off",
  "file": null,
  "url": null
}
```

---

### POST /url

Display a website in an iframe.

**Request:**
```json
{
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "status": "ok",
  "mode": "url",
  "file": null,
  "url": "https://example.com"
}
```

---

### POST /cache

Download a video from URL and save it locally. The file is saved with its MD5 hash as the filename.

**Request:**
```json
{
  "url": "https://example.com/video.mp4"
}
```

**Response:**
```json
{
  "status": "ok",
  "filename": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4",
  "alreadyCached": false,
  "playUrl": "/media/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4"
}
```

**Notes:**
- Validates the file is actually a video (checks magic bytes)
- Returns `alreadyCached: true` if file already exists
- Use the returned `filename` with `/file` endpoint to play it

---

### POST /cache_and_play

Download a video from URL and immediately start playing it.

**Request:**
```json
{
  "url": "https://example.com/video.mp4"
}
```

**Response:**
```json
{
  "status": "ok",
  "filename": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4",
  "alreadyCached": false,
  "playUrl": "/media/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4",
  "mode": "video",
  "file": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4"
}
```

---

### POST /youtube

Download a YouTube video using yt-dlp and cache it locally. Downloads best quality up to 1080p.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Response:**
```json
{
  "status": "ok",
  "filename": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4",
  "alreadyCached": false,
  "playUrl": "/media/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4"
}
```

**Notes:**
- Requires `yt-dlp` installed on the kiosk (setup script installs it)
- Caches by URL hash - same URL won't be re-downloaded
- Downloads best quality up to 1080p, merged to MP4
- Supports YouTube, Vimeo, and other yt-dlp compatible sites

**Errors:**
```json
{"error": "yt-dlp failed: Video unavailable"}
{"error": "Failed to start yt-dlp: Is yt-dlp installed?"}
```

---

### POST /youtube_and_play

Download a YouTube video and immediately start playing it.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Response:**
```json
{
  "status": "ok",
  "filename": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4",
  "alreadyCached": false,
  "playUrl": "/media/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4",
  "mode": "video",
  "file": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.mp4"
}
```

---

### POST /sync

Sync media files from an Eden collection (download only, don't play).

**Request:**
```json
{
  "collectionId": "68538ccaf883914b6b8e09a1",
  "db": "PROD"
}
```

**Parameters:**
- `collectionId` (required): Eden collection ID
- `db` (optional, default: "PROD"): Database environment - `"PROD"` or `"STAGE"`

**Response:**
```json
{
  "status": "ok",
  "collectionId": "68538ccaf883914b6b8e09a1",
  "db": "PROD",
  "downloaded": 5,
  "skipped": 2,
  "failed": 0,
  "files": [
    {"url": "https://...", "filename": "abc123.mp4", "status": "downloaded"},
    {"url": "https://...", "filename": "def456.mp4", "status": "skipped"}
  ]
}
```

**API Environments:**
- `PROD` → `https://api.eden.art`
- `STAGE` → `https://staging.api.eden.art`

**Requires:** `EDEN_API_KEY` configured on the kiosk.

---

### POST /sync_and_play

Sync an Eden collection and immediately start playing as a playlist.

**Request:**
```json
{
  "collectionId": "68538ccaf883914b6b8e09a1",
  "db": "PROD",
  "loop": true
}
```

**Parameters:**
- `collectionId` (required): Eden collection ID
- `db` (optional, default: "PROD"): Database environment - `"PROD"` or `"STAGE"`
- `loop` (optional, default: true): Whether to loop the playlist

**Response:**
```json
{
  "status": "ok",
  "collectionId": "68538ccaf883914b6b8e09a1",
  "db": "PROD",
  "mode": "playlist",
  "loop": true,
  "playlist": ["abc123.mp4", "def456.mp4", "ghi789.jpg"],
  "currentFile": "abc123.mp4",
  "syncResult": {
    "downloaded": 3,
    "skipped": 0,
    "failed": 0,
    "files": [...]
  }
}
```

**Playlist behavior:**
- Videos play to completion, then advance
- Images display for 10 seconds, then advance
- If `loop: true`, restarts from beginning after last item
- If `loop: false`, display goes black after last item

---

## WebSocket API

Connect to `wss://<kiosk-domain>.ngrok-free.app` for real-time state updates.

**Received messages:**
```json
{"type": "state", "mode": "video", "file": "example.mp4", "url": null, "playlist": null, "playlistIndex": 0, "loop": true}
```

**Send messages:**
```json
{"type": "ready"}   // Request current state
{"type": "next"}    // Skip to next item in playlist
```

---

## Error Responses

All errors return JSON with an `error` field:

```json
{"error": "Unauthorized. Provide API key via Authorization: Bearer <key> header"}
{"error": "Missing file parameter"}
{"error": "File not found: video.mp4"}
{"error": "EDEN_API_KEY not configured"}
```

HTTP status codes:
- `200` - Success
- `400` - Bad request (missing params, file not found)
- `401` - Unauthorized (missing/invalid API key)
- `404` - Endpoint not found
- `405` - Method not allowed
- `500` - Server error

---

## Example Workflows

### 1. Download and play a YouTube video
```bash
curl -X POST https://kiosk.ngrok-free.app/youtube_and_play \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

### 2. Cache and play a video from URL (one step)
```bash
curl -X POST https://kiosk.ngrok-free.app/cache_and_play \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/video.mp4"}'
```

### 3. Cache and play a video from URL (two steps)
```bash
# Download video
RESULT=$(curl -s -X POST https://kiosk.ngrok-free.app/cache \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/video.mp4"}')

# Extract filename
FILENAME=$(echo $RESULT | jq -r '.filename')

# Play it
curl -X POST https://kiosk.ngrok-free.app/file \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"file\": \"$FILENAME\"}"
```

### 4. Sync collection and play (production)
```bash
curl -X POST https://kiosk.ngrok-free.app/sync_and_play \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"collectionId": "68538ccaf883914b6b8e09a1", "loop": true}'
```

### 5. Sync collection from staging environment
```bash
curl -X POST https://kiosk.ngrok-free.app/sync_and_play \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"collectionId": "68538ccaf883914b6b8e09a1", "db": "STAGE", "loop": true}'
```

### 6. Check status and list files
```bash
# No auth needed for GET requests
curl https://kiosk.ngrok-free.app/status
curl https://kiosk.ngrok-free.app/files
```

### 7. Turn off display
```bash
curl -X POST https://kiosk.ngrok-free.app/off \
  -H "Authorization: Bearer $API_KEY"
```

---

## Python Client Example

```python
import requests

class KioskClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip('/')
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

    def status(self) -> dict:
        """Get current kiosk state (no auth required)."""
        r = requests.get(f'{self.base_url}/status')
        return r.json()

    def files(self) -> list:
        """List available media files (no auth required)."""
        r = requests.get(f'{self.base_url}/files')
        return r.json().get('files', [])

    def play(self, filename: str) -> dict:
        """Play a single video file (loops)."""
        r = requests.post(
            f'{self.base_url}/file',
            headers=self.headers,
            json={'file': filename}
        )
        return r.json()

    def off(self) -> dict:
        """Turn off the display."""
        r = requests.post(f'{self.base_url}/off', headers=self.headers)
        return r.json()

    def cache(self, url: str) -> dict:
        """Download and cache a video from URL."""
        r = requests.post(
            f'{self.base_url}/cache',
            headers=self.headers,
            json={'url': url}
        )
        return r.json()

    def cache_and_play(self, url: str) -> dict:
        """Download a video from URL and play immediately."""
        r = requests.post(
            f'{self.base_url}/cache_and_play',
            headers=self.headers,
            json={'url': url}
        )
        return r.json()

    def youtube(self, url: str) -> dict:
        """Download and cache a YouTube video."""
        r = requests.post(
            f'{self.base_url}/youtube',
            headers=self.headers,
            json={'url': url}
        )
        return r.json()

    def youtube_and_play(self, url: str) -> dict:
        """Download a YouTube video and play immediately."""
        r = requests.post(
            f'{self.base_url}/youtube_and_play',
            headers=self.headers,
            json={'url': url}
        )
        return r.json()

    def sync(self, collection_id: str, db: str = 'PROD') -> dict:
        """Sync Eden collection (download only)."""
        r = requests.post(
            f'{self.base_url}/sync',
            headers=self.headers,
            json={'collectionId': collection_id, 'db': db}
        )
        return r.json()

    def sync_and_play(self, collection_id: str, db: str = 'PROD', loop: bool = True) -> dict:
        """Sync Eden collection and play as playlist."""
        r = requests.post(
            f'{self.base_url}/sync_and_play',
            headers=self.headers,
            json={'collectionId': collection_id, 'db': db, 'loop': loop}
        )
        return r.json()

# Usage
kiosk = KioskClient('https://pi01.ngrok-free.app', 'your-api-key')
print(kiosk.status())
kiosk.play('example.mp4')
kiosk.youtube_and_play('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
kiosk.sync_and_play('collection-id', db='STAGE')
```

---

## TypeScript/JavaScript Client Example

```typescript
interface KioskStatus {
  mode: 'off' | 'video' | 'playlist' | 'url';
  file: string | null;
  url: string | null;
  playlist: string[] | null;
  playlistIndex: number;
  loop: boolean;
  wsClients: number;
}

type EdenDb = 'PROD' | 'STAGE';

class KioskClient {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  private async request(method: string, path: string, body?: object) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  async status(): Promise<KioskStatus> {
    const res = await fetch(`${this.baseUrl}/status`);
    return res.json();
  }

  async files(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/files`);
    const data = await res.json();
    return data.files;
  }

  async play(filename: string) {
    return this.request('POST', '/file', { file: filename });
  }

  async off() {
    return this.request('POST', '/off');
  }

  async cache(url: string) {
    return this.request('POST', '/cache', { url });
  }

  async cacheAndPlay(url: string) {
    return this.request('POST', '/cache_and_play', { url });
  }

  async youtube(url: string) {
    return this.request('POST', '/youtube', { url });
  }

  async youtubeAndPlay(url: string) {
    return this.request('POST', '/youtube_and_play', { url });
  }

  async sync(collectionId: string, db: EdenDb = 'PROD') {
    return this.request('POST', '/sync', { collectionId, db });
  }

  async syncAndPlay(collectionId: string, db: EdenDb = 'PROD', loop = true) {
    return this.request('POST', '/sync_and_play', { collectionId, db, loop });
  }
}

// Usage
const kiosk = new KioskClient('https://pi01.ngrok-free.app', 'your-api-key');
console.log(await kiosk.status());
await kiosk.play('example.mp4');
await kiosk.youtubeAndPlay('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await kiosk.syncAndPlay('collection-id', 'STAGE');
```
