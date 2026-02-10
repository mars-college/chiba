# Chiba (Cable Subsystem Summary)

This repo is a monorepo for the broader Chiba signage system plus **Chiba Cable**: a “TV guide + channels” experience designed to run as a kiosk on Raspberry Pis.

If you only care about Cable, start here: `cable/` and `scripts/pis/`.

## Cable In 60 Seconds

- **Guide UI** (`cable/apps/guide`): a React/Vite app that renders the grid, plays programs, and supports kiosk-style “gallery” autoplay.
- **Server** (`cable/apps/server`): an Express server that builds the index from TOML channel manifests, serves media (`/media`, `/cache`, `/stash`), hosts special low-data routes like `/weatherstar`, and serves the built Guide + Ops UI.
- **Channel configs** (`cable/config/channels/*.toml`): define what each channel is and what it plays.
- **Launch profiles** (`cable/config/profiles/*.toml` or `scripts/pis/modes/*.toml`): define kiosk URL params per-Pi (gallery mode, pinned channel, QR on/off, etc).
- **Pi tooling** (`scripts/pis/*`): bootstrap, update, prefetch stash media, apply launch profiles.

## Key Directories

- `cable/config/chiba.toml`: Cable server config (library roots, channel manifest dir, scheduling params).
- `cable/config/channels/*.toml`: Channel manifests (id/number/name/programs/embed/audio).
- `cable/config/profiles/*.toml`: “What to show” launch profiles for the fleet (composable with inventory).
- `scripts/pis/registry.toml`: Fleet inventory (hosts, node names, orientation/rotation).
- `scripts/pis/modes/*.toml`: Mode/profile files in the same shape as `cable/config/profiles/*.toml` (often install-specific templates).

## Apps (What Runs Where)

### `cable/apps/server` (Express, port `8787`)

Responsibilities:
- Build and serve the guide index at `GET /api/index`.
- Provide a WebSocket endpoint (`/ws`) used by the guide for live updates and remote control plumbing.
- Serve local media via `GET /media/...` (restricted to configured library roots).
- Serve cached remote media via `GET /cache/:id?url=...` (downloads and caches, size-limited).
- Serve stash-cached NAS media via `GET /stash/:id?path=...` ("fast 404 if not cached", optional background warming).
- Prefetch stash media via `POST /api/stash/prefetch` (used before gallery playlist installs).
- Serve embed helpers via `GET /embed/:id` (iframe/proxy pages driven by channel `[embed]` config).
- Serve “special channels” like `/weatherstar` (plus `/weatherstar.jpg`), `/village` (plus `/village.jpg` and `/village/live`), and `/mars`.
- Host built UIs from `cable/apps/guide/dist` and `cable/apps/ops/dist` (Ops UI is served under `/ops`).

Config location:
- The server reads `CHIBA_CONFIG` if set.
- Otherwise it prefers `cable/config/chiba.toml` and falls back to `config/chiba.toml` at repo root.

Useful env knobs (not exhaustive):
- `PORT` (default `8787`)
- `CHIBA_MEDIA_CACHE_DIR` (default `./media-cache` at repo root)
- `CHIBA_MEDIA_CACHE_MAX_BYTES` (default `1GiB`)
- `CHIBA_STASH_AUTOFETCH` (controls background warming behavior for stash cache misses)

### `cable/apps/guide` (React/Vite, kiosk UI)

Responsibilities:
- Renders the TV guide grid from `GET /api/index`.
- Plays a program URL as `image`, `video`, `audio`, or `iframe` (everything else, including server routes like `/weatherstar` or `/embed/...`).
- Supports **gallery mode** (kiosk/ambient behavior):
- In gallery mode, `gallery=1` enables autoplay into a pinned channel.
- In gallery mode, `playlist=1` turns a channel’s programs into a looping playlist (unique URLs).
- Gallery playlist mode has special handling for `/stash/...` items so cold caches don’t cause rapid “skip loops”.

### `cable/apps/ops` (React/Vite)

Ops UI intended for fleet visibility and control. The server also has a set of ops endpoints and helpers (`cable/apps/server/src/ops-*`) and serves the built Ops UI under `/ops`.

### `cable/apps/genart`

A small Vite app for generative visuals. Typically used as a source URL for a channel program (embedded as an iframe).

## Configuration Model

### Server Config: `cable/config/chiba.toml`

Key sections:
- `[server]` sets host/port (server defaults to `8787`).
- `[library] roots = [...]` are allowed media roots for `/media` and `/stash`.
- `[channels] manifest_dir = "channels"` points at `cable/config/channels/`.

### Channel Manifests: `cable/config/channels/*.toml`

Each channel TOML is parsed by the server and becomes a row in the guide index.

Common fields:
- `id`, `number`, `name`, `call_sign`, `accent`, `description`
- Optional audio bed uses `audio_source = { type = "path" | "url", value = "...", cache = true|false }` plus `audio_volume` and optional offset fields.
- Programs are repeated `[[program]]` entries (the loader also accepts `[[programs]]`).
- Program media uses `source = { type = "path" | "url", value = "...", cache = true|false }`.
- If a program `source` is `type="path"`, it becomes `/media/...` or `/stash/...` (when `cache=true`).
- If a program `source` is `type="url"`, it can be used directly or wrapped through `/cache/...` (when `cache=true`).
- Optional `[embed]` can render a proxy/iframe page at `/embed/<id>` (dismiss selectors, overlays, etc).

### Launch Profiles: `cable/config/profiles/*.toml`

These define how each Pi should launch the Cable Guide (they map to query params on the guide URL).

Schema:
- `[defaults.cable]` applies to all Pis.
- `[pis.<pi-id>.cable]` overrides for a single Pi.

The canonical key list is derived from code:
- Guide params: `cable/apps/guide/src/constants/params.ts`
- Profile keys and mapping: `cable/apps/server/src/ops-apply-mode.ts`
- Generated reference: `node scripts/pis/print-launch-options.mjs`

Important keys:
- `mode = "gallery"` emits `gallery=1`
- `channel = "weatherstar"` (or `"137"`) emits `channel=...`
- `playlist = true` emits `playlist=1`
- `nosplash = true` emits `nosplash=1`
- `lock = true|false` emits `lock=1` or (in gallery mode) `lock=0`
- `qr = false` emits `qr=0`
- `theme`, `scale`, `text_scale`, `hours`

Extra key used by Pi scripts (not a guide query param):
- `prefetch_channels = ["earl", ...]` is consumed by `scripts/pis/prefetch-stash.sh`.

### Inventory: `scripts/pis/registry.toml`

Inventory is the source of truth for:
- `host`, `ip`, `node_name`
- `orientation`, `display_rotate`
- `guide_port` (defaults to `5173` if not specified)

Profiles are composable with inventory: inventory describes hardware/addressing, profiles describe “what to show”.

## Preferred Launch + Ops Flows

### 1) Preferred: Fleet apply via Node API (fast, no SSH)

Use the ops CLI in the server package:

```sh
pnpm -C cable/apps/server ops:apply-mode -- \
  --inventory scripts/pis/registry.toml \
  --mode cable/config/profiles/default.toml \
  --all
```

What it does:
- Builds a kiosk URL like `http://localhost:5173/?screenId=<node_name>&gallery=1&channel=...`
- POSTs it to each Pi’s Node API on port `8080` (`POST /kiosk-url`)
- Uses per-node API keys via env (see `scripts/pis/pis-secrets.env.example`)

### 2) SSH-based apply (works without Node API keys)

```sh
PI_PASSWORD=interact ./scripts/pis/apply-cable-launch.sh \
  --inventory scripts/pis/registry.toml \
  --mode cable/config/profiles/default.toml \
  --all
```

This merges inventory + profile on your machine, then SSHes into each Pi to update the kiosk launch URL (and best-effort handle portrait rotation when configured in inventory).

## Remote Control Notes

- The guide has a “remote” view (separate UI) and uses the server WebSocket endpoint (`/ws`) to move selection, open programs, and drive app-specific controls.
- Protocol notes live in `cable/REMOTE_PROTOCOL.md`.

## Pi Lifecycle Scripts (`scripts/pis`)

Core scripts:
- `scripts/pis/bootstrap.sh` rsyncs the repo to a Pi, sets up services, and sets an initial kiosk URL.
- `scripts/pis/fast-cable-update.sh` syncs config/guide/server changes quickly without a full bootstrap.
- `scripts/pis/prefetch-stash.sh` warms NAS-backed (`/stash`) media on a Pi via `POST /api/stash/prefetch`.
- `scripts/pis/print-launch-options.mjs` prints a generated reference for guide query params and profile keys.

## Dev Commands (Local)

Run the Cable stack locally:

```sh
pnpm dev:cable
```

Or individually:

```sh
pnpm dev:cable:server
pnpm dev:cable:guide
pnpm dev:cable:ops
pnpm dev:cable:genart
```

Build:

```sh
pnpm build
pnpm build:cable:guide
pnpm build:cable:ops
```
