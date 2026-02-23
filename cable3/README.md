# cable3

`cable3` is the next clean implementation track for Chiba display orchestration.

`cable3` now includes a working control API, Ops/Guide apps, DB-backed MPBCP
resources, and a thin node runtime loop.

## Purpose

- Make nodes thin, deterministic clients.
- Centralize resolution and intent in the control plane.
- Enforce contracts end-to-end to eliminate ambiguous runtime behavior.
- Ship reliable operations tooling for cache/state/performance introspection.

## Current Status

- Phase: Active implementation
- Main document: `cable3/PLAN.md`
- Registry/namespace note: `cable3/docs/NAMESPACE_MODEL.md`

## Bootstrap (DB-first start)

```bash
cd /Users/jmill/projects/chiba/cable3
pnpm install
pnpm db:up
pnpm db:migrate

# import cable3 registry files as DB snapshots
pnpm db:import:registry -- --registry ./config/registry.local.toml --registry-id local
pnpm db:import:registry -- --registry ./config/registry.prod.toml --registry-id prod
# or both at once
pnpm db:import:registries

# import/export typed MPBCP resources
pnpm db:import:resources -- --file ./resources.json
pnpm db:snapshot:resources

# migrate selected cable2 channels (+dependent media/playlists/blocks) into cable3 DB
pnpm db:import:cable2-channels -- \
  --config-root ./cable2/config \
  --channels ai-village,ai-village-2,mars-public-access \
  --guide-base-url http://192.168.0.117:5173

# deterministic local seed:
# - cable3/assets as path media + playlist/block/channel loop
# - Jensen Art (3 replit programs) as 30-minute blocks + channel
# - cable2 channels: weatherstar, ai-village, roadmap, mars-public-access
pnpm db:seed:local -- --guide-base-url http://192.168.0.117:5173

# full reset + seed
pnpm db:reset:seed:local -- --guide-base-url http://192.168.0.117:5173

# run full local stack (control-api + ops + guide)
pnpm dev:stack

# optionally include a local node runtime shim
pnpm dev:stack:with-node
```

Environment:

- `CHIBA3_DB_URL` defaults to `postgresql://chiba:chiba@127.0.0.1:54339/chiba3`

## Docker (Full Host Stack)

`cable3` can run end-to-end via `docker compose` with ingestion toolchain deps baked
into the image (`ffmpeg`, `yt-dlp`, `unzip`, `zip`, `awscli`).

```bash
cd /Users/jmill/projects/chiba/cable3
docker compose up --build
```

Optional services:

- Include node runtime shim:
```bash
docker compose --profile node up --build
```
- Include MCP server:
```bash
docker compose --profile mcp up --build
```

## Docker (Production Stack, stay-on defaults)

Use the production compose file + launcher script. Services are configured with:

- `restart: unless-stopped` for long-running services
- healthchecks + dependency gating
- one-shot DB migration/registry import init jobs before `control-api` starts

Setup:

```bash
cd /Users/jmill/projects/chiba/cable3
cp .env.prod.example .env.prod
# edit .env.prod for real hostnames/passwords
```

Start/stop:

```bash
pnpm prod:up
pnpm prod:status
pnpm prod:logs
pnpm prod:down
```

Optional profiles:

```bash
bash ./scripts/prod/start-stack.sh start --with-node
bash ./scripts/prod/start-stack.sh start --with-mcp
```

Run under tmux:

```bash
bash ./scripts/prod/start-stack.sh start --tmux --session cable3-prod
```

`--tmux` runs compose in foreground mode inside that session so logs stay attached.

Main files:

- `cable3/docker-compose.prod.yml`
- `cable3/Dockerfile.prod`
- `cable3/.env.prod.example`
- `cable3/scripts/prod/start-stack.sh`

Default service URLs:

- control-api: `http://127.0.0.1:8795`
- ops: `http://127.0.0.1:8792`
- guide: `http://127.0.0.1:5173`
- minio API: `http://127.0.0.1:9000`
- minio console: `http://127.0.0.1:9001` (`minioadmin` / `minioadmin`)

Shared asset storage inside the stack:

- NAS-like root in container: `/share`
- ingested assets: `/share/chiba-cable/assets`
- generated thumbs: `/share/chiba-cable/assets/.thumbs`

Implemented now:

- Postgres docker stack (`cable3/docker-compose.yml`)
- Production compose stack (`cable3/docker-compose.prod.yml`)
- SQL migration runner (`cable3/packages/db/src/migrate.ts`)
- Initial schema (`cable3/packages/db/migrations/001_init.sql`)
- Registry import from TOML into DB (`cable3/packages/db/src/registry-import.ts`)
- Shared contracts seed (`cable3/packages/contracts/src/index.ts`)
- Control API (`cable3/apps/control-api/src/index.ts`)
- Ops app moved to `cable3/apps/ops`
- Guide app moved to `cable3/apps/guide`
- Local expectations harness starter (`cable3/packages/node-runtime/src/scenario-runner.ts`)
- Node runtime loop with control-plane resolve + cache + `mpv` playback (`cable3/packages/node-runtime/src/local-node.ts`)
- Typed resource persistence APIs:
  - `POST /api/v1/resources/import`
  - `GET /api/v1/resources/snapshot`
  - `GET /api/v1/screen-assignments`
  - `GET /api/v1/runtime/resolve/:screenId`
- Node ops passthrough APIs:
  - `GET /api/ops/nodes/:nodeId/runtime-status`
  - `GET /api/ops/nodes/:nodeId/cache`
  - `DELETE /api/ops/nodes/:nodeId/cache`
  - `POST /api/ops/nodes/:nodeId/input`
- Ingestion APIs (sync + queued):
  - `POST /api/v1/ingest/upload`
  - `POST /api/v1/ingest/youtube`
  - `POST /api/v1/ingest/eden-collection`
  - `POST /api/v1/ingest/jobs/upload`
  - `POST /api/v1/ingest/jobs/youtube`
  - `POST /api/v1/ingest/jobs/eden-collection`
  - `GET /api/v1/ingest/jobs`
  - `GET /api/v1/ingest/jobs/:jobId`

## Ops Builder (local)

The Ops UI lives in `cable3/apps/ops` and syncs MPBCP drafts directly to DB:

1. Start stack:
```bash
cd /Users/jmill/projects/chiba/cable3
pnpm dev:stack
```
2. Open Ops at `http://127.0.0.1:8792/ops/`
3. In `MPBCP Builder`, use:
- `Push to DB` (writes drafts)
- `Load from DB` (pulls persisted snapshot)

### Quick local scenario test

In terminal A:
```bash
cd /Users/jmill/projects/chiba/cable3
pnpm dev:control-api
```

In terminal B:
```bash
cd /Users/jmill/projects/chiba/cable3
pnpm -C packages/node-runtime scenario -- --file ./scenarios/playlist_switch.local.json
```

## Pi Bootstrap (runtime only)

To ship only `node-runtime` + `contracts` to a Pi and install a dedicated
`cable3-node-runtime` service:

```bash
cd /Users/jmill/projects/chiba
CHIBA3_CONTROL_API_URL=http://<control-plane-host>:8795 \
pnpm -C cable3 bootstrap:node-runtime <node-id>
```

For explicit runtime endpoints (no hardcoded script defaults):

```bash
cd /Users/jmill/projects/chiba
pnpm -C cable3 bootstrap:node-runtime <node-id> \
  --control-api-url http://<control-plane-host>:8795 \
  --node-control-api-url http://<control-plane-host>:8795 \
  --guide-base-url http://<control-plane-host>:5173 \
  --switch-overlap-ms 900
```

For Home Assistant login automation via runtime env creds:

```bash
cd /Users/jmill/projects/chiba
pnpm -C cable3 bootstrap:node-runtime <node-id> \
  --node-control-api-url http://<control-plane-host>:8795 \
  --guide-base-url http://<control-plane-host>:5173 \
  --ha-automation true \
  --ha-user '<ha-username>' \
  --ha-pass '<ha-password>' \
  --ha-url http://<ha-host>:8123 \
  --ha-start-delay-ms 1800 \
  --ha-step-delay-ms 180
```

Notes:
- `--control-api-url` is used by the bootstrap command on the control machine for DB/API lookup.
- `--node-control-api-url` is what gets written into the node runtime service.
- `--guide-base-url` is what nodes use to build guide kiosk URLs.
- `--switch-overlap-ms` delays teardown of the prior fullscreen backend during guide/media handoff to reduce desktop flicker.
- HA automation flags write runtime env used by `node-runtime` when a target resolves to Home Assistant.
- If `--guide-base-url` is omitted, it is derived from `--node-control-api-url` host + resolved `guidePort`.
- For password-based SSH nodes, set `CHIBA3_SSH_PASSWORD` (or pass `--ssh-password`).
- To retarget a deployed node without redeploy/build, run bootstrap with `--endpoints-only`.
- Runtime env is persisted on-node at `/etc/default/cable3-node-runtime` (mode `0600`).

Bootstrap also installs a fresh `cable3-network-watchdog` timer/service pair.
It intentionally removes legacy `chiba-*` runtime/watchdog services and old kiosk
artifacts (`.kiosk-url`/`.kiosk_url`) so cable3 is the only runtime authority.

Node host/ip and per-node ports are resolved from `GET /api/ops/nodes` (DB-backed),
auto-trying `local` and `prod` registry ids when not specified.
`--registry <path>` remains as legacy fallback only.

By default, watchdog health requires local route + gateway reachability only
(`CHECK_INTERNET=0`) to support static-IP nodes during WAN outages. Optional
overrides can be set in `/etc/default/cable3-network-watchdog`.

## Local Topology (what talks to what)

When running `pnpm dev:cable3`:

- Guide app: `http://<laptop-ip>:5173`
- Ops app: `http://<laptop-ip>:8792/ops/`
- Control API: `http://<laptop-ip>:8795`

Node-runtime behavior:

- Polls Control API (`CHIBA3_CONTROL_API_URL`) for resolved runtime target.
- Launches Guide/Chromium against `CHIBA3_GUIDE_BASE_URL`.
- For local laptop testing, both URLs must use a LAN-reachable host/IP, never `localhost`.

Practical rule:

- If your laptop IP changes, rerun bootstrap with `--endpoints-only` and updated
  `--node-control-api-url` + `--guide-base-url`.

## Scope Notes

- `cable2` remains the active runtime while `cable3` is built and validated.
- `cable3` should only replace `cable2` after passing cutover gates in `PLAN.md`.
