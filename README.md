# Raspberry Pi Digital Signage

A lightweight digital signage solution for Raspberry Pi. Node.js server with real-time WebSocket control and a React player optimized for smooth video playback.

## Features

- Full-screen kiosk mode with Chromium
- Real-time WebSocket control (instant video switching)
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
  --eden-key YOUR_EDEN_API_KEY
```

Or download and run manually:

```bash
wget https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh
chmod +x setup-kiosk.sh
./setup-kiosk.sh \
  --ngrok-token YOUR_NGROK_AUTHTOKEN \
  --ngrok-domain YOUR_DOMAIN.ngrok-free.app \
  --eden-key YOUR_EDEN_API_KEY
```

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

## Local Development

Run the server locally to test:

```bash
npm install
node server.js
```

Open http://localhost:8080/player in your browser.

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
```

### Playlist Behavior

- **Videos**: Play to completion, then advance to next
- **Images**: Display for 10 seconds, then advance to next
- **Loop mode**: After last item, restart from beginning
- **No loop**: After last item, display goes black

### WebSocket

Connect to `wss://your-domain.ngrok-free.app` for real-time state updates:

```json
{"type": "state", "mode": "video", "file": "example.mp4", "url": null}
{"type": "state", "mode": "playlist", "file": "current.mp4", "playlist": [...], "loop": true}
{"type": "state", "mode": "off", "file": null, "url": null}
```

## File Structure

```
chiba/
├── server.js           # Node.js server (HTTP + WebSocket)
├── eden.js             # Eden API integration
├── run_kiosk.sh        # Full kiosk mode (server + Chromium)
├── setup-kiosk.sh      # Pi setup script (with ngrok)
├── status.sh           # Check kiosk status
├── .env                # API keys (created by setup)
├── .env.example        # Example env file
├── public/             # Player app (built)
│   ├── index.html
│   └── assets/
├── media/              # Video/image files
└── player/             # React source code
```

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
