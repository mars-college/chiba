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
channel = "earl"
playlist = true
prefetch_channels = ["earl"]
```

## Supported Keys

These map to query params on `http://localhost:5173/` (the Cable Guide):

- `mode = "gallery"`
  - Emits `gallery=1` (enables autoplay into the pinned channel).
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

Notes:
- The canonical list of query params lives in `cable2/apps/guide/src/constants/params.ts`.
- Rotation/orientation are not part of profiles; they are hardware properties in `scripts/pis/registry.toml`.

## Prefetch (Caching Strategy)

Profiles can optionally include a launcher-only hint:

- `prefetch_channels = ["earl", ...]`

When present:
- `pnpm -C cable2/apps/server ops:apply-mode` will ask each Pi's Cable server (port `8787`) to prefetch media for those channels:
  - NAS-backed `source.type="path" + cache=true` via `POST /api/stash/prefetch`
  - Remote `source.type="url" + cache=true` via `POST /api/cache/prefetch`
- `scripts/pis/prefetch-stash.sh` also consumes `prefetch_channels` to warm `/stash` items before gallery playlists.

If you only care about the NAS stash cache (the common case for gallery installs), leave the config as-is.

## Generated Reference

To print a generated Markdown reference (from source-of-truth code), run:

```sh
node scripts/pis/print-launch-options.mjs
```
