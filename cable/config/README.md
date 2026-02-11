# Cable Config Model

This directory defines **what Cable can show** (channels and schedules) and **how kiosks should launch** (profiles).

The config model is in a transition period:
- Legacy: channels inline `[[program]]` entries.
- New: channels reference `blocks`, which reference `playlists`, which reference reusable `media` objects.

The server supports both. When `blocks` are present on a channel, **blocks take precedence**.

## Definitions

### Media (`cable/config/media/*.toml`)

Reusable media objects.

Minimal shape:
- `id = "..."` (string, required)
- `source = { type = "path"|"url", value = "...", cache = true|false }` (required)

Optional metadata:
- `kind = "image"|"video"|"audio"|"web"` (informational today)
- `title`, `subtitle`, `tag`, `artist`, `description`

### Playlists (`cable/config/playlists/*.toml`)

Composable lists of media items.

Minimal shape:
- `id = "..."` (required)
- `[[item]]` entries, each referencing `media = "<media-id>"` (preferred) or inlining `source = {...}`

Playlist items can also carry per-item overrides:
- `duration_slots`, `title`, `subtitle`, `tag`, `remote_controls`, HUD fields, etc

### Blocks (`cable/config/blocks/*.toml`)

Blocks are the thing that fills time slots.

For now, blocks are simple:
- `id = "..."` (required)
- `mode = "loop"` (default) and `playlist = "<playlist-id>"`

We can extend blocks later to support:
- bumpers, commercials
- “clocked” playback (sync at a wall clock boundary)
- “continue from last position” semantics

### Channels (`cable/config/channels/*.toml`)

Channels define:
- identity (`id`, `number`, `name`, `call_sign`, etc)
- optional audio bed (`audio_source`)
- optional embed helpers (`[embed]`)
- schedule:
  - legacy: `[[program]]` entries
  - new: `blocks = ["blk-..."]` (recommended)

If both are present, the server uses `blocks` and treats `[[program]]` as legacy fallback.

### Profiles (`cable/config/profiles/*.toml`)

Profiles map to **kiosk launch state** (query params).

See `cable/config/profiles/README.md`.

## Source Of Truth Types

Code shapes and parsing live in:
- `cable/apps/server/src/config.ts`
- `cable/apps/server/src/index-builder-config.ts`

