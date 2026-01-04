# Raspberry Pi Digital Signage

A lightweight digital signage solution for Raspberry Pi. Node.js server with real-time WebSocket control and a React player optimized for smooth video playback.

## Features

- Full-screen kiosk mode with Chromium
- Real-time WebSocket control (instant video switching)
- **Central controller** for managing multiple Pis from one endpoint
- Playlist support (videos + images)
- Eden collection sync (download and play from Eden API)
- **YouTube video download** via yt-dlp (up to 1080p)
- Public URL via ngrok tunnel
- **API key authentication** for secure remote control
- HTTP API for curl/scripting
- USB audio device auto-detection
- Video with audio (USB speakers or HDMI)
- Local video files and web URLs
- Auto-start on boot
- Minimal resource usage

## Architecture Options

### Option 1: Central Controller (Recommended for Multiple Pis)

A single controller routes commands to multiple Pis via local network:

```
Client → ngrok → Controller → mars01.local:8080
                            → mars02.local:8080
                            → mars04.local:8080
```

- Single ngrok tunnel for all Pis
- Commands include `--kiosk` parameter to target specific Pi
- Pis accessible by mDNS hostname (e.g., `mars01.local`)

### Option 2: Direct Access (Single Pi)

Each Pi has its own ngrok tunnel for direct access:

```
Client → ngrok → Pi
```

## Quick Start

### Prerequisites

Before setting up a Pi, you need:

1. **ngrok account** (free): https://dashboard.ngrok.com
   - Get your authtoken from the dashboard
   - Create a free static domain (e.g., `pi01-xyz.ngrok-free.app`)

2. **Eden API key** (optional): For syncing collections from Eden

### Raspberry Pi Setup

**1. Flash Raspberry Pi OS**

Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to flash **Raspberry Pi OS 64-bit Lite** (or Desktop).

In the imager settings:
- Enable SSH
- Set username to `pi`
- Configure WiFi (optional)

**2. Run the setup script**

SSH into the Pi and run:

```bash
curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh | bash -s -- \
  --ngrok-token YOUR_NGROK_AUTHTOKEN \
  --ngrok-domain YOUR_DOMAIN.ngrok-free.app \
  --eden-key YOUR_EDEN_API_KEY \
  --api-key YOUR_API_KEY
```

Or download and run manually:

```bash
wget https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh
chmod +x setup-kiosk.sh
./setup-kiosk.sh \
  --ngrok-token YOUR_NGROK_AUTHTOKEN \
  --ngrok-domain YOUR_DOMAIN.ngrok-free.app \
  --eden-key YOUR_EDEN_API_KEY \
  --api-key YOUR_API_KEY
```

**Setup options:**

| Option | Required | Description |
|--------|----------|-------------|
| `--ngrok-token` | Yes | Your ngrok authtoken |
| `--ngrok-domain` | Yes | Static domain for this Pi |
| `--eden-key` | No | Eden API key for collection sync |
| `--api-key` | No | API key for bearer auth (auto-generated if omitted) |

**3. Reboot**

The setup script will prompt to reboot. After reboot:
- Kiosk starts automatically on the connected display
- ngrok tunnel starts automatically
- Your Pi is accessible at `https://YOUR_DOMAIN.ngrok-free.app`

### Setting Up Multiple Pis

For each Pi, create a unique ngrok domain in your dashboard, then run the setup with that domain:

| Pi | ngrok Domain | Setup Command |
|----|--------------|---------------|
| Pi 01 | `pi01-abc.ngrok-free.app` | `./setup-kiosk.sh --ngrok-token XXX --ngrok-domain pi01-abc.ngrok-free.app` |
| Pi 02 | `pi02-def.ngrok-free.app` | `./setup-kiosk.sh --ngrok-token XXX --ngrok-domain pi02-def.ngrok-free.app` |
| Pi 03 | `pi03-ghi.ngrok-free.app` | `./setup-kiosk.sh --ngrok-token XXX --ngrok-domain pi03-ghi.ngrok-free.app` |

All Pis can share the same ngrok authtoken and Eden API key.

---

## Central Controller Setup (Multiple Pis)

For managing multiple Pis from a single endpoint, set up a central controller on a Linux box.

### 1. Set up the Controller

On a Linux machine (not a Pi) on the same network as your Pis:

```bash
# Clone the repo
git clone https://github.com/mars-college/chiba.git
cd chiba

# Run controller setup
./setup-controller.sh \
  --ngrok-token YOUR_NGROK_AUTHTOKEN \
  --ngrok-domain controller.ngrok-free.app \
  --prefix mars \
  --max 20
```

**Setup options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--ngrok-token` | - | Your ngrok authtoken (optional if local only) |
| `--ngrok-domain` | - | Static domain for controller |
| `--api-key` | auto | API key (auto-generated if omitted) |
| `--prefix` | `mars` | Pi hostname prefix for discovery |
| `--max` | `20` | Max number of Pis to scan |

### 2. Set up Local Pis

On each Raspberry Pi, use the simplified local setup (no ngrok):

```bash
curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk-local.sh | bash
```

Or with Eden API key:

```bash
./setup-kiosk-local.sh --eden-key YOUR_EDEN_API_KEY
```

**Important:** Make sure each Pi has a unique hostname (e.g., `mars01`, `mars02`, etc.):

```bash
sudo hostnamectl set-hostname mars01
sudo reboot
```

### 3. Control Pis via Controller

```bash
# Discover Pis on the network
curl https://controller.ngrok-free.app/discover

# Check status of a specific Pi
curl 'https://controller.ngrok-free.app/status?kiosk=mars01.local'

# Play video on mars01
curl -X POST https://controller.ngrok-free.app/file \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kiosk": "mars01.local", "file": "video.mp4"}'

# Or use the client script
./controller-client.sh --kiosk mars01.local file video.mp4
./controller-client.sh --kiosk mars02.local youtube "https://youtube.com/watch?v=xxx"
```

---

## Supported Hardware

- **Raspberry Pi 5** (recommended) - Best performance
- **Raspberry Pi 4** - Works well
- **Raspberry Pi 3** - Minimum, may struggle with 1080p

### Storage Requirements

- **Base install:** ~500MB
- **Per video:** Varies (10MB - 1GB typical)
- **Recommended:** 16GB+ SD card

## Local Development

Run the server locally to test:

```bash
# Install dependencies
npm install

# Create .env file (optional, but required for auth)
cp .env.example .env
# Edit .env with your API_KEY if needed

# Start server
node server.js
```

Open http://localhost:8080/player in your browser.

### Player Development

For live-reload when developing the React player:

```bash
# Terminal 1: Run the server
node server.js

# Terminal 2: Run Vite dev server
cd player
npm install
npm run dev
```

Open http://localhost:5173 for the dev player (proxies API to server).

### Debug Mode

The player has a debug overlay that shows current state. To enable:

1. Edit `player/src/App.tsx`
2. Set `const DEBUG = true`
3. Rebuild: `cd player && npm run build`

The overlay shows: mode, file, paused state, and errors.

## API Reference

The server runs on port **8080** with HTTP + WebSocket on the same port.

> **Full API documentation:** See [API.md](API.md) for complete endpoint reference, code examples, and client libraries.

### Authentication

All POST endpoints require an API key. The setup script generates one automatically - **save it during setup!**

Include the key in your requests:
```bash
curl -X POST https://your-domain.ngrok-free.app/file \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"file": "example.mp4"}'
```

GET endpoints (`/status`, `/files`, `/player`, `/media/*`) are public and don't require authentication.

### Endpoints

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/status` | - | Server status + connected clients |
| GET | `/files` | - | List media files |
| GET | `/player` | - | Serve the player app |
| GET | `/media/<file>` | - | Serve a media file |
| POST | `/file` | `{"file": "video.mp4"}` | Play a single video (loop) |
| POST | `/url` | `{"url": "https://..."}` | Show website in iframe |
| POST | `/off` | - | Black screen |
| POST | `/cache` | `{"url": "https://..."}` | Download video from URL |
| POST | `/cache_and_play` | `{"url": "https://..."}` | Download + play immediately |
| POST | `/youtube` | `{"url": "https://youtube.com/..."}` | Download YouTube video |
| POST | `/youtube_and_play` | `{"url": "https://youtube.com/..."}` | Download YouTube + play |
| POST | `/sync` | `{"collectionId": "...", "db": "PROD"}` | Download collection from Eden |
| POST | `/sync_and_play` | `{"collectionId": "...", "db": "PROD", "loop": true}` | Sync + play as playlist |
| POST | `/playlist` | `{"items": [...], "loop": true}` | Create playlist from files/URLs |
| POST | `/next` | `{}` | Skip to next item |
| POST | `/previous` | `{}` | Go to previous item |
| POST | `/pause` | `{}` | Pause playback |
| POST | `/resume` | `{}` | Resume playback |
| POST | `/restart` | `{}` | Restart playlist from beginning |
| GET | `/volume` | - | Get current volume (0-10) |
| POST | `/volume` | `{"level": 7}` | Set volume (0-10) |

**Note:** Eden endpoints accept `db` parameter: `"PROD"` (default) or `"STAGE"` for staging API.

### Examples

```bash
# Check status
curl https://your-domain.ngrok-free.app/status

# List files
curl https://your-domain.ngrok-free.app/files

# Play a single video (loops)
curl -X POST https://your-domain.ngrok-free.app/file \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"file": "example.mp4"}'

# Download and play a YouTube video
curl -X POST https://your-domain.ngrok-free.app/youtube_and_play \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# Download any video URL and play immediately
curl -X POST https://your-domain.ngrok-free.app/cache_and_play \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/video.mp4"}'

# Sync Eden collection and play as playlist
curl -X POST https://your-domain.ngrok-free.app/sync_and_play \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"collectionId": "68538ccaf883914b6b8e09a1", "loop": true}'

# Sync from Eden staging environment
curl -X POST https://your-domain.ngrok-free.app/sync_and_play \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"collectionId": "68538ccaf883914b6b8e09a1", "db": "STAGE"}'

# Turn off display
curl -X POST https://your-domain.ngrok-free.app/off \
  -H "Authorization: Bearer YOUR_API_KEY"

# Create a custom playlist from files and URLs
curl -X POST https://your-domain.ngrok-free.app/playlist \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"file": "video1.mp4"}, {"url": "https://example.com/video.mp4"}], "loop": true}'

# Playback controls
curl -X POST https://your-domain.ngrok-free.app/pause -H "Authorization: Bearer YOUR_API_KEY"
curl -X POST https://your-domain.ngrok-free.app/resume -H "Authorization: Bearer YOUR_API_KEY"
curl -X POST https://your-domain.ngrok-free.app/next -H "Authorization: Bearer YOUR_API_KEY"
curl -X POST https://your-domain.ngrok-free.app/previous -H "Authorization: Bearer YOUR_API_KEY"

# Volume control (0-10)
curl https://your-domain.ngrok-free.app/volume
curl -X POST https://your-domain.ngrok-free.app/volume \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"level": 7}'
```

### Supported Media Formats

**Videos** (validated by magic bytes):
- MP4 (`.mp4`, `.m4v`) - Recommended
- WebM (`.webm`)
- MOV (`.mov`)
- MKV (`.mkv`)
- AVI (`.avi`)

**Images** (for playlists):
- JPG/JPEG, PNG, GIF, WebP, BMP, SVG

### Playlist Behavior

- **Videos**: Play to completion, then advance to next
- **Images**: Display for 10 seconds, then advance to next
- **Loop mode**: After last item, restart from beginning
- **No loop**: After last item, display goes black

### WebSocket

Connect to `wss://your-domain.ngrok-free.app` for real-time state updates:

```json
{"type": "state", "mode": "video", "file": "example.mp4", "url": null, "paused": false}
{"type": "state", "mode": "playlist", "file": "current.mp4", "playlist": [...], "loop": true, "paused": false}
{"type": "state", "mode": "off", "file": null, "url": null, "paused": false}
```

## File Structure

```
chiba/
├── server.js              # Kiosk server (HTTP + WebSocket)
├── controller.js          # Central controller for multiple Pis
├── eden.js                # Eden API integration
├── run_kiosk.sh           # Full kiosk mode (server + Chromium)
├── setup-kiosk.sh         # Pi setup script (with ngrok)
├── setup-kiosk-local.sh   # Pi setup script (no ngrok, for controller mode)
├── setup-controller.sh    # Controller setup script
├── kiosk-server.sh        # Server-only startup
├── kiosk-client.sh        # Test client script (direct Pi access)
├── controller-client.sh   # Controller client script (with --kiosk)
├── find-pis.sh            # Discover Pis on network
├── status.sh              # Check kiosk status
├── .env                   # API keys (created by setup)
├── .env.example           # Example env file
├── API.md                 # Full API documentation
├── public/                # Player app (built)
│   ├── index.html
│   └── assets/
├── media/                 # Video/image files
├── player/                # React source code
│   ├── src/App.tsx        # Main player component
│   └── vite.config.ts     # Build configuration
└── tests/                 # Test scripts
```

## Security Notes

- **API Key**: Store securely. Required for all POST requests.
- **ngrok**: All traffic goes through HTTPS via ngrok tunnel.
- **WebSocket**: Currently unauthenticated (for player access).
- **.env file**: Created with `chmod 600` (owner-only access).
- **Query param auth**: Available but less secure (logged in URLs).

## Kiosk Management

```bash
# Check status (from SSH)
cd ~/chiba && ./status.sh

# View ngrok tunnel status
sudo systemctl status ngrok

# View kiosk logs
journalctl -u ngrok -f

# Restart ngrok tunnel
sudo systemctl restart ngrok

# Stop kiosk (from TTY2: Ctrl+Alt+F2)
pkill -f run_kiosk

# Full restart
sudo reboot
```

## Troubleshooting

### ngrok not connecting

```bash
# Check ngrok status
sudo systemctl status ngrok

# Check ngrok logs
journalctl -u ngrok --no-pager -n 50

# Test ngrok manually
ngrok http 8080 --domain=your-domain.ngrok-free.app
```

### Screen stays black

1. Check if server is running: `curl http://localhost:8080/status`
2. Check WebSocket clients: should show `wsClients: 1`
3. Verify Chromium is running: `pgrep chromium`

### No audio

The setup script auto-detects USB audio devices and configures them as default.

```bash
# List audio devices
aplay -l

# Check current ALSA config
cat ~/.asoundrc

# Test audio output
speaker-test -t wav -c 2

# For USB speakers, check it's not in Bluetooth mode
# The speaker should show "USB" on its display, not a Bluetooth device name

# Set volume to max
amixer -c S3 set PCM 100% unmute  # Replace S3 with your device name

# For HDMI audio instead of USB
sudo raspi-config  # System Options > Audio > HDMI
```

## Development

### Rebuilding the Player

```bash
cd player
npm install
npm run build   # Outputs to public/
```

### Adding Support for New File Types

Edit `server.js` to add MIME types:

```javascript
const mimeTypes = {
  '.mp4': 'video/mp4',
  // add more...
};
```

## License

MIT
