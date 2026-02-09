# Pi Bootstrap

Bootstrap a Raspberry Pi with Chiba + Chiba Cable from your local checkout.

## Setup

1) Edit `registry.toml` (committable) with hostnames + node names.
2) Put secrets in a local env file (gitignored) such as `./scripts/pis/.env.pis.local`.
   Use `pis-secrets.env.example` as a template for variable names.
3) Run the bootstrap script for a registered Pi:

```sh
./scripts/pis/bootstrap.sh upper-east-2
```

The script will:
- rsync the repo to `/home/pi/chiba`
- run `scripts/setup-node.sh` with `--skip-git`
- install + enable `chiba-cable-server` and `chiba-cable-guide`
- set the kiosk URL to `http://localhost:5173/?screenId=<node_name>`
- optionally mount the NAS if credentials are present

## Notes

- The registry is TOML (to match channel configs).
- Secrets are loaded from env (optionally via `./scripts/pis/.env.pis.local`).

## Fast Cable Updates

Minimal, fast updates (no full bootstrap, no dependency installs):

```sh
# Update channel + cable config everywhere (hot reload: no restarts needed)
./scripts/pis/fast-cable-update.sh \
  --registry ./scripts/pis/registry.toml \
  --all --config --jobs 6

# Update guide UI (build once locally, sync dist, then restart kiosk to reload Chromium)
./scripts/pis/fast-cable-update.sh \
  --registry ./scripts/pis/registry.toml \
  --all --guide --build-guide --kiosk-restart --jobs 6

# Update server code only (tsx watch typically reloads automatically)
./scripts/pis/fast-cable-update.sh \
  --registry ./scripts/pis/registry.toml \
  --all --server --jobs 6
```

## Gallery Modes

Apply a "mode/profile" (kiosk URL parameters, channel pinning, QR hide/lock) from a file.
This uses each Pi's Node API on port 8080 (`POST /kiosk-url`), so it requires per-node API keys in env:
`CHIBA_API_KEY_<PI_ID_SUFFIX>` (see `pis-secrets.env.example`).

```sh
pnpm -C cable/apps/server ops:apply-mode -- \
  --inventory scripts/pis/registry.toml \
  --mode cable/config/profiles/default.toml \
  --all
```

If you want to apply a local (ssh-based) launch profile that merges inventory + mode, use:

```sh
./scripts/pis/apply-cable-launch.sh \
  --inventory ./scripts/pis/registry.toml \
  --mode ./cable/config/profiles/midterms-gallery.toml \
  --pi upper-west-4
```

Portrait screens:
- Mark `orientation = "portrait"` in `registry.toml` for that Pi.
- `apply-cable-launch.sh` will best-effort call the node rotate endpoint so Chromium runs in portrait.

## Stash Prefetch (NAS -> Pi Cache)

For channels that use NAS paths with `cache = true` (served via `/stash/...`), you can prefetch the
media onto a Pi so gallery playlist mode doesn't "skip" while warming.

Add `prefetch_channels = ["earl"]` under `[pis.<name>.cable]` (or just set `channel = "earl"`),
then run:

```sh
./scripts/pis/prefetch-stash.sh \
  --inventory ./scripts/pis/registry.toml \
  --mode ./cable/config/profiles/midterms-gallery.toml \
  --pi upper-west-4 --wait
```

## Health Check

Quick SSH-based status for a set of Pis:

```sh
PI_PASSWORD=interact ./scripts/pis/healthcheck.sh --auto mars 32
```

## WiFi Recovery

If a Pi is physically accessible but has no IP (dashboard shows `127.0.0.1`), run on the Pi:

```sh
sudo /home/pi/chiba/scripts/pis/wifi-recover.sh --ssid "BRAHMAN-AI" --psk '...'
```
