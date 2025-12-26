# Raspberry Pi Digital Signage

A lightweight digital signage solution for Raspberry Pi. Node.js server with real-time WebSocket control and a React player optimized for smooth video playback.

## Features

- Full-screen kiosk mode with Chromium
- Real-time WebSocket control (instant video switching)
- Optimized React player (~61KB gzipped)
- HTTP API for curl/scripting
- Video with audio (HDMI output)
- Local video files and web URLs
- Auto-start on boot
- Minimal resource usage

## Quick Start (Local Development)

Run the server locally to test:

```bash
# Install dependencies
npm install

# Start server
node server.js
```

Open http://localhost:8080/player in your browser.

Switch videos with curl:

```bash
curl -X POST http://localhost:8080/file -H "Content-Type: application/json" -d '{"file": "example.mp4"}'
```

**Audio note:** Browsers block autoplay with audio. Click anywhere on the player to enable audio. For testing with auto-audio, launch Chrome with:

```bash
# macOS
open -a "Google Chrome" --args --autoplay-policy=no-user-gesture-required http://localhost:8080/player
```

On Pi kiosk mode, audio plays automatically (no click needed).

## Raspberry Pi Deployment

### Requirements

- Raspberry Pi 5 (or Pi 4)
- Raspberry Pi OS 64-bit (Bookworm)
- Monitor connected via HDMI

### 1. Flash Raspberry Pi OS

Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to flash Raspberry Pi OS 64-bit. Enable SSH and set username to `pi`.

### 2. Run setup script

SSH into the Pi and run the setup script directly:

```bash
ssh pi@<IP>
curl -sL https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh | bash
```

Or download and run manually:

```bash
ssh pi@<IP>
wget https://raw.githubusercontent.com/mars-college/chiba/main/setup-kiosk.sh
chmod +x setup-kiosk.sh && ./setup-kiosk.sh
```

The setup script will:
- Clone the repository from GitHub
- Install Node.js, Chromium, and cage (Wayland compositor)
- Set environment variables (`NODE_ENV=production`, etc.)
- Configure auto-start on boot (via autologin to TTY1)
- Disable screen blanking
- Prompt to reboot

### 3. Add your videos

```bash
scp your-video.mp4 pi@<IP>:/home/pi/chiba/media/
```

The kiosk will auto-start on boot after setup completes.

## Running Modes

### Full Kiosk Mode (Pi)

Runs server + Chromium in full-screen kiosk mode. Used for production on Pi.

```bash
./run_kiosk.sh
```

### Server-Only Mode

Runs just the server without launching a browser. Use for:
- Local development on your Mac/PC
- Remote access (view player in any browser)
- Headless Pi setups

```bash
./kiosk-server.sh
# or
node server.js
```

Then open http://\<IP\>:8080/player in any browser.

## API Reference

The server runs on port **8080** with HTTP + WebSocket on the same port.

### HTTP Endpoints

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/` | - | API info |
| GET | `/status` | - | Server status + connected clients |
| GET | `/files` | - | List media files |
| GET | `/player` | - | Serve the player app |
| GET | `/media/<file>` | - | Serve a media file |
| POST | `/file` | `{"file": "video.mp4"}` | Switch to video |
| POST | `/url` | `{"url": "https://..."}` | Show website |
| POST | `/off` | - | Black screen |
| POST | `/cache` | `{"url": "https://..."}` | Download & cache video from URL |

### Examples

```bash
# Switch to a video
curl -X POST http://<IP>:8080/file \
  -H "Content-Type: application/json" \
  -d '{"file": "example.mp4"}'

# Switch to another video
curl -X POST http://<IP>:8080/file \
  -H "Content-Type: application/json" \
  -d '{"file": "example2.mp4"}'

# Show a website
curl -X POST http://<IP>:8080/url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Turn off (black screen)
curl -X POST http://<IP>:8080/off

# Check status
curl http://<IP>:8080/status

# List available files
curl http://<IP>:8080/files

# Cache a video from URL (downloads and saves as MD5 hash)
curl -X POST http://<IP>:8080/cache \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/video.mp4"}'
# Returns: {"status":"ok","filename":"a1b2c3d4...","alreadyCached":false}

# Then play the cached video
curl -X POST http://<IP>:8080/file \
  -H "Content-Type: application/json" \
  -d '{"file": "a1b2c3d4e5f6..."}'
```

### WebSocket

Connect to `ws://<IP>:8080` for real-time state updates:

```json
{"type": "state", "mode": "video", "file": "example.mp4", "url": null}
{"type": "state", "mode": "url", "file": null, "url": "https://..."}
{"type": "state", "mode": "off", "file": null, "url": null}
```

### Test Script

Run the included test script to cycle through commands:

```bash
./kiosk-client.sh <IP>
```

## File Structure

```
project/
├── server.js           # Node.js server (HTTP + WebSocket)
├── run_kiosk.sh        # Full kiosk mode (server + Chromium)
├── kiosk-server.sh     # Server-only mode
├── setup-kiosk.sh      # Pi setup script
├── kiosk-client.sh     # API test script
├── package.json
├── public/             # Player app (built)
│   ├── index.html
│   └── assets/
├── media/              # Video files
│   └── *.mp4
└── player/             # React source code
    ├── src/
    ├── vite.config.ts
    └── package.json
```

## Development

### Rebuilding the Player

The React player source is in `player/`. To rebuild after changes:

```bash
cd player
npm install
npm run build   # Outputs to public/
```

### Adding New Video Formats

Edit `server.js` and add MIME types to the `mimeTypes` object:

```javascript
const mimeTypes = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  // add more...
};
```

## Kiosk Management (Pi)

The kiosk auto-starts on boot via autologin to TTY1.

```bash
# Stop kiosk (from SSH or TTY2)
pkill -f run_kiosk

# Restart kiosk
sudo reboot

# Test server manually (via SSH)
cd ~/chiba && node server.js

# Disable auto-start
sed -i '/run_kiosk.sh/d' ~/.bash_profile
```

## Troubleshooting

### Server not responding

```bash
# Check if processes are running
ps aux | grep -E "node|chromium"

# Test server manually
cd ~/chiba && node server.js
```

### Screen stays blank

1. Verify Node.js: `node --version`
2. Test manually: `cd ~/chiba && ./run_kiosk.sh`
3. Check display: ensure HDMI is connected before boot

### Video not playing

- Ensure video is in `/home/pi/chiba/media/`
- Check permissions: `ls -la /home/pi/chiba/media/`
- Supported formats: mp4, webm, mov, mkv

### WebSocket not connecting

- Verify server is running: `curl http://<IP>:8080/status`
- Check firewall: `sudo ufw status`
- Both HTTP and WebSocket use port 8080

### No audio on Pi

```bash
# Check audio output device
amixer

# Set HDMI audio output
sudo raspi-config
# Navigate to: System Options > Audio > HDMI

# Test audio
speaker-test -t wav -c 2
```

## License

MIT
