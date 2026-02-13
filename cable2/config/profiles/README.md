# Cable Launch Profiles

Profiles are TOML files that define how the **Cable Guide** should launch on each Pi.

They are *composable* with the inventory registry:

- Inventory (hardware + addressing): `scripts/pis/registry.toml`
  - `host`, `ip`, `node_name`
  - `orientation`, `display_rotate`
- Profile (what to show): files in `cable2/config/profiles/*.toml`

## Applying Profiles

Apply a profile to the whole fleet (recommended):

```sh
pnpm -C cable2/apps/server ops:apply-mode -- \
  --inventory scripts/pis/registry.toml \
  --mode cable2/config/profiles/default.toml \
  --all
```

Apply via SSH (does not require node API keys):

```sh
PI_PASSWORD=interact ./scripts/pis/apply-cable-launch.sh \
  --inventory scripts/pis/registry.toml \
  --mode cable2/config/profiles/default.toml \
  --all
```

## Profile Schema

Each profile file can contain:

- `[defaults.cable]` (applies to all Pis)
- `[pis.<pi-id>.cable]` (overrides for a single Pi)

Example:

```toml
[defaults.cable]
mode = "gallery"
theme = "gallery"
nosplash = true
lock = true
qr = false

[pis.upper-west-4.cable]
target_kind = "playlist"
target_id = "pl-earl"
playlist = true
prefetch_targets = ["playlist:pl-earl"]

[[prepare.dir]]
path = "/Volumes/share/chiba-cable/assets/mc26/midterms/co-lab"
playlist_id = "pl-co-lab"
playlist_title = "Co-Lab playlist"
tag = "CO-LAB"
cache = true

[[prepare.eden_collection]]
source = "https://app.eden.art/collections/6980dc94fec7de4f6abca3a9"
db = "PROD"
playlist_id = "pl-scanalyzer-daily-digest"
playlist_title = "Scanalyzer Daily Digest"
tag = "MARZIPAN"
artist = "Marzipan"
cache = true
```

## Supported Keys

These map to query params on `http://localhost:5173/` (the Cable Guide):

- `mode = "gallery"`
  - Emits `gallery=1` (enables autoplay into the pinned channel).
- `target_kind = "media|playlist|block|channel"`
- `target_id = "..."`
  - Semantic apply target for this node. This is now the preferred way to pin content.
  - Back-compat: `channel = "..."` is treated as `target_kind="channel"` + `target_id="<channel>"`.
- `theme = "..."` -> `theme=...`
- `channel = "..."` -> `channel=...`
  - Can be a channel id (e.g. `weatherstar`) or a numeric channel string.
- `nosplash = true` -> `nosplash=1`
- `qr = false` -> `qr=0`
  - `lock = true` -> `lock=1`
  - `lock = false` (only in gallery mode) -> `lock=0`
  - In gallery mode, the guide defaults to locked unless explicitly overridden.
- `qr = true` -> `qr=1` (forces QR on even in gallery mode)
- `playlist = true` -> `playlist=1`
- `scale = <number>` -> `scale=<n>`
- `text_scale = <number>` -> `textScale=<n>`
- `hours = <number>` -> `hours=<n>`
- `ambient_channels = ["a", "b", ...]`
  - Launcher-only behavior: if `channel` is unset/blank, the launcher picks a deterministic per-Pi channel from this pool (seeded by `CHIBA_AMBIENT_SEED`, default `YYYY-MM-DD`). This does not map to a guide query param.
- `[[prepare.dir]]`
  - Profile preparation step: scans a local directory and generates `media/*.toml` + a `playlist`.
  - Supports optional channel wrapper generation via `channel_id/channel_name/channel_number`, but playlist-first targets are preferred.
- `[[prepare.eden_collection]]`
  - Profile preparation step: fetches an Eden collection and generates `media/*.toml` + a `playlist`.
  - Supports `db`, `artist`, `max_items`, and optional channel wrapper generation.

Notes:
- The canonical list of query params lives in `cable2/apps/guide/src/constants/params.ts`.
- Rotation/orientation are not part of profiles; they are hardware properties in `scripts/pis/registry.toml`.

## Prefetch (Caching Strategy)

Profiles can optionally include a launcher-only hint:

- `prefetch_channels = ["earl", ...]`
- `prefetch_targets = ["playlist:pl-earl", "channel:weatherstar", ...]`

When present:
- `pnpm -C cable2/apps/server ops:apply-mode` will ask each Pi's Cable server (port `8787`) to prefetch media for those targets/channels:
  - NAS-backed `source.type="path" + cache=true` via `POST /api/stash/prefetch`
  - Remote `source.type="url" + cache=true` via `POST /api/cache/prefetch`
- `scripts/pis/prefetch-stash.sh` also consumes `prefetch_channels` to warm `/stash` items before gallery playlists.

If you only care about the NAS stash cache (the common case for gallery installs), leave the config as-is.

## Preparation Step (Data-Driven Imports)

Use a profile's `[[prepare.*]]` definitions to generate/import dependencies before apply:

```sh
EDEN_API_KEY=... \
node cable2/packages/cli/dist/index.js prepare profile midterms-gallery --write --json
```

Flags:
- `--write`
  - Persist generated TOML files. Without this, preparation runs as dry-run.
- `--continue-on-error`
  - Continue remaining prepare steps if one fails.

## Generated Reference

To print a generated Markdown reference (from source-of-truth code), run:

```sh
node scripts/pis/print-launch-options.mjs
```
