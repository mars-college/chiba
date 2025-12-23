# Raspberry Pi Digital Signage

A lightweight digital signage solution for Raspberry Pi. Node.js server with real-time WebSocket control and a React player optimized for smooth video playback.

## Features

- Full-screen kiosk mode with Chromium
- Real-time WebSocket control (instant video switching)
- Optimized React player (~61KB gzipped)
- HTTP API for curl/scripting
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
- Create and enable the systemd service
- Configure auto-start on boot
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
├── kiosk.service       # Systemd service file
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

## Service Management (Pi)

```bash
# Start/stop/restart
sudo systemctl start kiosk
sudo systemctl stop kiosk
sudo systemctl restart kiosk

# Check status
sudo systemctl status kiosk

# View logs
journalctl -u kiosk -f

# Disable auto-start
sudo systemctl disable kiosk
```

## Troubleshooting

### Server not responding

```bash
sudo systemctl status kiosk
journalctl -u kiosk -e
```

### Screen stays blank

1. Check logs: `journalctl -u kiosk -e`
2. Verify Node.js: `node --version`
3. Test manually: `./run_kiosk.sh`

### Video not playing

- Ensure video is in `/home/pi/media/`
- Check permissions: `ls -la /home/pi/media/`
- Supported formats: mp4, webm, mov, mkv

### WebSocket not connecting

- Verify server is running: `curl http://<IP>:8080/status`
- Check firewall: `sudo ufw status`
- Both HTTP and WebSocket use port 8080

## License

MIT
