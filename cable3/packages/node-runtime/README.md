# cable3 node-runtime

Thin node execution runtime for cable3.

Responsibilities:
- reconcile desired revision
- warm required artifacts from resolved control-plane manifests
- activate renderer atomically
- report runtime phase and blockers

Renderer policy:
- `mpv` for media playback (including cached path/url-backed media)
- Chromium only for guide/web targets

Useful runtime knobs:
- `CHIBA3_SWITCH_OVERLAP_MS` (default `700`): keeps the previous fullscreen backend alive briefly during `chromium <-> mpv` handoff to reduce desktop/window flicker. Set to `0` to disable.
- `CHIBA3_WEB_READY_TIMEOUT_MS` (default `5000`): wait budget for web target HTTP readiness before Chromium switchover.
- `CHIBA3_WEB_READY_POLL_MS` (default `200`): polling interval for web readiness checks.
- `CHIBA3_INPUT_BIN` (default `xdotool`): Linux input passthrough command used by `POST /api/input`.
- `CHIBA3_INPUT_ALLOW_ANY_PLATFORM=1`: dev/test override for non-Linux hosts.

Node-local passthrough endpoint:
- `POST /api/input` with typed payload (`key`, `text`, `mouse_move`, `mouse_click`).
- Requires active Chromium backend.

## Deterministic Integration Proof

Run the end-to-end deterministic harness:

```bash
pnpm -C packages/node-runtime test
```

The test spins up:
- a mock control API (apply + resolve + runtime-report endpoints),
- a mock asset server with two image assets,
- a spawned `local-node` process with a mock `mpv` binary.

It asserts deterministic behavior for:
- apply target `playlist:X` to a node,
- prefetch/download of playlist media `Y` and `Z`,
- activation with `mpv` loop mode,
- configured image duration constant (`--image-display-duration=<sec>`).

Current deterministic tests:
- `deterministic-playlist-loop.test.ts`: initial apply + prefetch + active loop.
- `deterministic-playlist-switchover.test.ts`: revision increment + playlist switchover + cache reuse.
- `planner-apply-matrix.test.ts`: deterministic assignment planning for `media|playlist|block|channel|profile`, including profile multi-node overrides.
