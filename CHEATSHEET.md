# Chiba Cheatsheet

## 1. Initial Setup

```bash
# Generate API key and create .env
./scripts/init-chiba.sh

# With Eden API key
./scripts/init-chiba.sh --eden-key "your-eden-api-key"
```

This creates `.env` with your secrets and prints the deploy command for Pis.

## 2. Build & Test

```bash
pnpm install        # install dependencies
pnpm build          # build all packages
pnpm test           # run all tests
pnpm test:watch     # watch mode
```

## 3. Local Dev (Single Machine)

Terminal 1 - Controller (port 8080):
```bash
pnpm dev:controller
```

Terminal 2 - Node (port 8081):
```bash
PORT=8081 CONTROLLER_URL=http://localhost:8080 NODE_NAME=local-dev pnpm dev:node
```

Terminal 3 - Player UI (port 3010):
```bash
pnpm dev:player
# Open http://localhost:3010?ws=ws://localhost:8081/ws
```

Terminal 4 - Dashboard (port 3011):
```bash
pnpm dev:dashboard
# Open http://localhost:3011
```

## 4. Node API Commands

```bash
NODE=localhost:8081

# Status (public)
curl $NODE/status
curl $NODE/files
curl $NODE/debug

# Play (auto-detects source type)
curl -X POST $NODE/play -d '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}'
curl -X POST $NODE/play -d '{"url":"https://example.com/video.mp4"}'
curl -X POST $NODE/play -d '{"filename":"abc123.mp4"}'
curl -X POST $NODE/play -d '{"collectionId":"6526f380...","db":"PROD"}'

# Cache (download without playing)
curl -X POST $NODE/cache -d '{"url":"https://example.com/video.mp4"}'
curl -X POST $NODE/cache -d '{"collectionId":"6526f380...","db":"PROD"}'

# Playback control
curl -X POST $NODE/stop
curl -X POST $NODE/pause
curl -X POST $NODE/resume
curl -X POST $NODE/next
curl -X POST $NODE/previous

# Volume (0-100)
curl -X POST $NODE/volume -d '{"level":75}'

# Loop toggle
curl -X POST $NODE/loop -d '{"enabled":true}'

# Shuffle toggle
curl -X POST $NODE/shuffle -d '{"enabled":true}'

# Image duration (ms) - how long images display in playlists
curl -X POST $NODE/image-duration -d '{"duration":5000}'

# Append items to current playlist (or create new one)
curl -X POST $NODE/append -d '{"items":[{"id":"1","content":{"type":"file","filename":"abc.mp4"},"order":0}]}'

# Rename node
curl -X POST $NODE/rename -d '{"name":"Living Room"}'

# Rotate display (0, 90, 180, 270)
curl -X POST $NODE/rotate -d '{"rotation":90}'

# Exit kiosk mode
curl -X POST $NODE/exit-kiosk

# Set kiosk URL (e.g., point to Chiba Cable)
curl -X POST $NODE/kiosk-url -d '{"url":"http://controller:8787/?screenId=pi-01"}'

# Restart kiosk without changing URL
curl -X POST $NODE/kiosk-restart

# Clear all cached content
curl -X POST $NODE/clear-cache
```

## 5. Pi Deployment

### Step 1: Initialize secrets (on your machine)

```bash
./scripts/init-chiba.sh --eden-key "your-eden-key"
```

This outputs the deploy command with secrets pre-filled.

### Step 2: Run on each Pi

SSH into each Pi and run the command from step 1:

```bash
curl -sL "https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh?v=$(date +%s)" | bash -s -- \
  --controller-url http://CONTROLLER_IP:8080 \
  --node-name living-room \
  --api-key "your-api-key" \
  --eden-key "your-eden-key"
```

### Step 3: Reboot

The Pi will reboot and auto-start as a kiosk.

### Find Pis on network

```bash
./scripts/find-pis.sh              # finds mars01.local - mars20.local
./scripts/find-pis.sh chiba 10     # finds chiba01.local - chiba10.local
```

### Rename a node

```bash
./scripts/rename.sh mars01.local "Living Room"
./scripts/rename.sh 192.168.1.50 "Kitchen Display"
./scripts/rename.sh mars03 "Bedroom"   # .local added automatically
```

### Rotate display

```bash
# Via API (remote, any machine)
./scripts/rotate.sh mars01.local 90    # rotate to 90°
./scripts/rotate.sh 192.168.1.50 0     # rotate to normal

# Or directly via curl
curl -X POST http://mars01.local:8080/rotate -d '{"rotation":90}'

# Run on the Pi locally
./scripts/rotate-display.sh 0      # normal (landscape)
./scripts/rotate-display.sh 90     # 90° clockwise (portrait)
./scripts/rotate-display.sh 180    # upside down
./scripts/rotate-display.sh 270    # 270° clockwise (portrait)

# Also accepts names
./scripts/rotate-display.sh normal
./scripts/rotate-display.sh right
./scripts/rotate-display.sh inverted
./scripts/rotate-display.sh left

# Via SSH
ssh pi@mars01.local "~/chiba/scripts/rotate-display.sh 90"
```

### Upgrade nodes and controller

```bash
# Upgrade controller (local)
./scripts/upgrade-controller.sh

# Upgrade a specific node (via SSH)
./scripts/upgrade-controller.sh --node pi@mars01.local

# Upgrade all connected nodes
./scripts/upgrade-controller.sh --all-nodes

# Options
./scripts/upgrade-controller.sh --backup       # backup data first
./scripts/upgrade-controller.sh --clean        # clean node_modules
./scripts/upgrade-controller.sh --no-restart   # don't restart services

# Upgrade node directly (run on Pi)
./scripts/upgrade-node.sh          # soft upgrade: git pull + rebuild
./scripts/upgrade-node.sh hard     # full reinstall (preserves config)
```

### Check node status

```bash
# On controller
curl localhost:8080/api/nodes

# On individual Pi
curl 192.168.1.101:8080/status
```

### Node service commands (on Pi)

```bash
sudo systemctl start chiba-node
sudo systemctl stop chiba-node
sudo systemctl restart chiba-node
sudo systemctl status chiba-node
journalctl -u chiba-node -f        # view logs
```

### Network watchdog & auto-reboot (on Pi)

```bash
# View watchdog logs
journalctl -u chiba-network-watchdog -f        # follow live
journalctl -u chiba-network-watchdog -n 100    # last 100 lines

# Toggle auto-reboot (reboots Pi if network down ~10min and idle)
./chiba/scripts/auto-reboot.sh on      # enable
./chiba/scripts/auto-reboot.sh off     # disable
./chiba/scripts/auto-reboot.sh         # check status
./chiba/scripts/auto-reboot.sh reset   # reset counter after manual fix

# Enable persistent logs (survive reboots)
sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald
```

## 6. Reference

### Ports

| Service | Port |
|---------|------|
| Controller | 8080 |
| Node | 8080 |
| Player (dev) | 3010 |
| Dashboard (dev) | 3011 |

### Environment Variables

```bash
# Controller
PORT=8080
API_KEY=shared-secret
LOG_LEVEL=info

# Node
PORT=8080
API_KEY=shared-secret
EDEN_API_KEY=eden-key
CONTROLLER_URL=http://controller:8080
NODE_NAME=friendly-name
LOG_LEVEL=info
```

### WebSocket Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/ws` | Node ↔ Player (playback state) |
| `/ws/nodes` | Controller ↔ Nodes (registration, heartbeat) |
| `/ws/dashboard` | Controller ↔ Dashboard (real-time updates) |

### Content Caching

- Files cached by MD5 hash: `{hash}.{ext}`
- Same content = same hash = no duplicate downloads
- Stored in `./media` directory

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init-chiba.sh` | Generate secrets, create .env, show deploy command |
| `scripts/setup-node.sh` | Full Pi setup (run on Pi) |
| `scripts/find-pis.sh` | Discover Pis by mDNS |
| `scripts/rename.sh` | Rename a node's friendly name (via API) |
| `scripts/rotate.sh` | Rotate display via API (remote) |
| `scripts/rotate-display.sh` | Rotate display locally (run on Pi) |
| `scripts/upgrade-controller.sh` | Upgrade controller or nodes |
| `scripts/upgrade-node.sh` | Upgrade node directly (run on Pi) |
| `scripts/network-watchdog.sh` | Network recovery daemon (systemd service) |
| `scripts/auto-reboot.sh` | Toggle auto-reboot on/off (run on Pi) |
