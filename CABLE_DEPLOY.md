# Chiba Cable Pi Bootstrap

This assumes you can SSH into a Pi and want it to run:
- Chiba node (kiosk controller)
- Chiba Cable (guide + server)

## One-step bootstrap

Run from your machine (not on the Pi):

```bash
./scripts/bootstrap-cable-pi.sh \
  --host mars01.local \
  --controller-url http://192.168.1.10:8080 \
  --node-name living-room
```

Defaults:
- Guide port: `5173`
- Cable server port: `8787`
- User: `pi`

### Optional flags

```bash
--user pi
--guide-port 5173
--server-port 8787
--remote-url http://100.128.0.213:5173
```

If you set `--remote-url`, the server will always generate QR codes pointing there.

## What it does

1) Installs or upgrades the Chiba node on the Pi  
2) Clones/updates `chiba-cable` and installs deps  
3) Creates systemd services:
   - `chiba-cable-server` (port 8787)
   - `chiba-cable-guide` (port 5173, `--host 0.0.0.0`)
4) Sets kiosk URL to `http://localhost:5173/?screenId=<node-name>`

## Useful commands on the Pi

```bash
systemctl status chiba-node
systemctl status chiba-cable-server
systemctl status chiba-cable-guide

journalctl -u chiba-cable-server -n 100 --no-pager
journalctl -u chiba-cable-guide -n 100 --no-pager
```
