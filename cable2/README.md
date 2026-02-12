# Cable2

New CLI-first control plane for Chiba Cable.

## Priorities

- Shared contracts and data types first.
- `chiba` CLI first.
- Canonical node registry is `scripts/pis/registry.toml` (repo root).
- Optional local overlay from `scripts/pis/registry.local.toml`.
- Single shared node API key via `CHIBA_NODE_API_KEY`.

## Code Location

Active runnable code should live in `cable2/`:
- `cable2/apps/*` for web/server apps
- `cable2/packages/*` for shared/core/cli/agent/control-plane
- `cable2/scripts/pis/bootstrap.sh` as canonical node setup/startup script
- canonical public registry remains `scripts/pis/registry.toml` at repo root

## Quick Start (scaffold stage)

```sh
pnpm -C cable2 install
pnpm -C cable2 typecheck
pnpm -C cable2 build
```

## Postgres (preferred)

```sh
pnpm -C cable2 db:up
pnpm -C cable2 dev:control-plane:pg
```

Default DB URL used by the script:
- `postgresql://chiba:chiba@127.0.0.1:54329/chiba`

Control-plane falls back to file storage when `CHIBA_CONTROL_DB_URL` is unset.

## Local E2E

Single command:
```sh
pnpm -C cable2 dev:local
```

If you are already in `cable2/`, run:
```sh
pnpm dev:local
```

Open:
- `http://127.0.0.1:8787/ops`

Notes:
- This command brings up Postgres, builds guide/ops once, and starts:
  - control-plane (`8790`)
  - node-agent (`8080`, `commander`)
  - server/ops (`8787`)
- `cable2/config/registry.local.toml` is the local dev registry fixture.
- Included nodes in that fixture:
  - `commander` (`127.0.0.1`)
  - `pi-local` (`192.168.0.4`)
- `node_port` is used for node-agent apply/status (`8080`).
- `server_port` is for cable server (`8787`).
- Override targets (including future `10.10.13.9`) with env:
  - `CHIBA_CONTROL_PLANE_URL`
  - `CHIBA_OPS_CONTROL_PLANE_URL`
  - `CHIBA_CONTROL_DB_URL`
  - `CHIBA_NODE_API_KEY`

CLI usage (current):

```sh
pnpm -C cable2 build
node cable2/packages/cli/dist/index.js get nodes
node cable2/packages/cli/dist/index.js apply profile default --dry-run --nodes commander --json
node cable2/packages/cli/dist/index.js apply channel weatherstar --execute --nodes commander --timeout-ms 1200 --json
```

Directory import (NAS -> media + playlist):

```sh
node cable2/packages/cli/dist/index.js import dir '/Volumes/share/chiba-cable/assets/mc26/midterms/co-lab' \
  --playlist-id pl-co-lab \
  --playlist-title 'Co-Lab playlist' \
  --tag CO-LAB \
  --write --json
```

Notes:
- `import dir` scans supported media files, generates deterministic `m-*` IDs from source paths, writes `config/media/*.toml`, and writes a playlist TOML.
- Channel wrappers are optional. For the semantic model, prefer applying playlists/blocks/media directly.

Eden collection import (Eden API -> media + playlist, optional channel wrapper):

```sh
EDEN_API_KEY=... \
node cable2/packages/cli/dist/index.js import eden-collection \
  'https://app.eden.art/collections/6980dc94fec7de4f6abca3a9' \
  --playlist-id pl-scanalyzer-daily-digest \
  --playlist-title 'Scanalyzer Daily Digest' \
  --tag MARZIPAN \
  --cache \
  --write --json
```

```sh
EDEN_API_KEY=... \
node cable2/packages/cli/dist/index.js import eden-collection \
  'https://app.eden.art/collections/698739a2eb7e84c5958045d3' \
  --playlist-id pl-mars-college-logo-remixes-v4 \
  --playlist-title 'Mars College Logo remixes (volume 4)' \
  --tag MARZIPAN \
  --cache \
  --write --json
```

Notes:
- `import eden-collection` pulls collection items from Eden (`EDEN_API_KEY` required) and writes deterministic media IDs (`m-eden-<creationId>`).
- Dry-run by default. Add `--write` to persist.
- Optional: `--db STAGE` for staging Eden, `--max-items N` to cap imports.
- Midterms profile assignment is prewired with playlist targets:
  - `upper-west-4` -> `playlist:pl-earl`
  - `upper-east-4` -> `playlist:pl-co-lab`

Profile-driven preparation (recommended):

```sh
EDEN_API_KEY=... \
node cable2/packages/cli/dist/index.js prepare profile midterms-gallery --write --json
```

Notes:
- `prepare profile` reads `[[prepare.*]]` steps from `config/profiles/<profile>.toml`.
- It can run mixed dependency sources in one command (`prepare.dir`, `prepare.eden_collection`).
- Use this before `apply profile ...` so all playlists/media dependencies exist and prefetch targets resolve cleanly.

## Commands

```sh
# Inventory + catalog
node cable2/packages/cli/dist/index.js get nodes
node cable2/packages/cli/dist/index.js inspect node commander
node cable2/packages/cli/dist/index.js inspect node commander --fetch --timeout-ms 800 --json
node cable2/packages/cli/dist/index.js get media
node cable2/packages/cli/dist/index.js get playlists
node cable2/packages/cli/dist/index.js get blocks
node cable2/packages/cli/dist/index.js get channels
node cable2/packages/cli/dist/index.js get profiles

# Plan/apply
node cable2/packages/cli/dist/index.js apply profile default --dry-run --nodes commander --json
node cable2/packages/cli/dist/index.js apply channel weatherstar --dry-run --nodes commander --json
node cable2/packages/cli/dist/index.js apply block blk-weatherstar --dry-run --nodes commander --json
node cable2/packages/cli/dist/index.js apply playlist pl-weatherstar --dry-run --nodes commander --json
node cable2/packages/cli/dist/index.js apply media m-weatherstar-4000-545cc68a76 --dry-run --nodes commander --json

# Execute dispatch directly to node agents
node cable2/packages/cli/dist/index.js apply media m-weatherstar-4000-545cc68a76 --execute --nodes commander --timeout-ms 1200 --json

# Control-plane history
node cable2/packages/cli/dist/index.js get operations --control-plane http://localhost:8790 --json
node cable2/packages/cli/dist/index.js get desired-state --control-plane http://localhost:8790 --json
node cable2/packages/cli/dist/index.js get node-status --control-plane http://localhost:8790 --json
node cable2/packages/cli/dist/index.js diff profile default --nodes commander --fetch --json
```

## Shared API Key

Single shared key source order:
1. `CHIBA_NODE_API_KEY`
2. `CHIBA_API_KEY`
3. `defaults.api_key` in merged registry

Per-node API keys in registry are ignored by policy.

`CHIBA_NODE_API_KEY` is the canonical env var for cable2.
`CHIBA_API_KEY` is kept as a legacy compatibility alias and should usually have the same value.

## Registry Inputs

- Canonical: `scripts/pis/registry.toml` (repo root)
- Optional local overlay: `scripts/pis/registry.local.toml`

Override flags:

```sh
node cable2/packages/cli/dist/index.js get nodes --registry /abs/path/to/registry.toml
node cable2/packages/cli/dist/index.js get nodes --no-registry-local
```

## Control Plane / Node Agent (build-ready)

```sh
node cable2/packages/control-plane/dist/index.js
node cable2/packages/node-agent/dist/index.js
```

Node agent can report heartbeat/status to control-plane:

```sh
CHIBA_CONTROL_PLANE_URL=http://localhost:8790 \
node cable2/packages/node-agent/dist/index.js
```

Control-plane URL is configurable per component:
- CLI: `--control-plane http://host:8790`
- Server ops proxy: `CHIBA_OPS_CONTROL_PLANE_URL=http://host:8790`
- Node-agent heartbeat: `CHIBA_CONTROL_PLANE_URL=http://host:8790`

## Node Bootstrap

Canonical startup/setup script:

```sh
./cable2/scripts/pis/bootstrap.sh <pi-name>
```

`bootstrap.sh` auto-loads env from either:
- `cable2/.env.pis.local`
- `.env.pis.local` (repo root)

Simplest (recommended) bootstrap via CLI wrapper:

```sh
node cable2/packages/cli/dist/index.js bootstrap pi-local \
  --registry ./cable2/config/registry.local.toml \
  --control-plane-url http://192.168.0.117:8790
```

Direct script bootstrap with explicit env file:

```sh
./cable2/scripts/pis/bootstrap.sh pi-local \
  --env-file ./cable2/.env.pis.local \
  --registry ./cable2/config/registry.local.toml \
  --control-plane-url http://192.168.0.117:8790
```

Bootstrap reboots the Pi by default when complete.
Use `--no-reboot` only for debugging iterations.

Bootstrap resolves API key in this order:
1. `CHIBA_NODE_API_KEY_<PI_NAME>`
2. `CHIBA_API_KEY_<PI_NAME>`
3. `CHIBA_NODE_API_KEY`
4. `CHIBA_API_KEY`
5. `defaults.api_key` in registry

After bootstrap, the Pi runs:
- `chiba-cable-server`
- `chiba-cable-guide`
- `chiba-cable2-node-agent`
- `chiba-kiosk` (Chromium fullscreen launcher on tty1)
- `chiba-network-watchdog`

Display boot behavior:
- Pi boots to kiosk mode (no desktop manager).
- Default screen when nothing is applied: TV guide (`/?screenId=<node>`).
- `apply channel|profile` retunes kiosk URL directly.
- `apply block|playlist|media` resolves to a containing channel when possible; otherwise falls back to guide and returns a warning in node-agent apply response.

Wi-Fi recovery is included:
- bootstrap ensures a `chiba-network-watchdog` systemd service exists on the Pi.
- it attempts interface + DHCP + Wi-Fi radio recovery when connectivity drops.
- `--enable-auto-reboot` enables reboot fallback after sustained failures.

When control-plane is running, CLI can route apply through it:

```sh
node cable2/packages/cli/dist/index.js apply profile default \
  --control-plane http://localhost:8790 \
  --execute --nodes commander --json
```
