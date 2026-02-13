# Cable2 Plan

## Scope

Rebuild the Cable stack in `cable2` with a clean control plane and CLI-first workflow.

Primary priorities:
- CLI and shared data types first.
- LAN-first architecture.
- Treat a Mac dev machine as a first-class node for local testing.
- `apply` operations for: `profile`, `channel`, `block`, `playlist`, `media`.
- All active/runnable scripts and apps should live under `cable2/`.
- In `cable2/scripts`, keep only `pis/bootstrap.sh` (canonical node startup) and `pis/registry.toml`.
- Registry/public inventory source of truth remains `scripts/pis/registry.toml`.
- Local secret overlays can be supplied via `scripts/pis/registry.local.toml`.
- Use a single shared node API key across the fleet (no per-node key requirement).
- Defer clock-sync/live-sync to a later v1+ phase.

## Non-Goals (for first build)

- Internet-facing hardening.
- Multi-tenant auth model.
- Frame-accurate synchronized playback.

## Principles

- Single source of truth for desired state (control-plane DB).
- Explicit desired vs actual state reconciliation.
- Strongly typed contracts shared between CLI, ops server, and node runtime.
- Reproducible local development with deterministic test fixtures.

## Proposed Package Layout

`cable2/` will start as a workspace with shared contracts:

- `packages/contracts`
  - Zod/TypeScript schemas and DTOs for media, playlists, blocks, channels, profiles, nodes, apply operations, health, cache status.
- `packages/core`
  - Domain logic: graph resolution (`media -> playlist -> block -> channel -> profile`), validation, dependency expansion, reconciliation planner.
- `packages/cli`
  - `chiba` executable with kubectl-style verbs.
- `packages/control-plane`
  - API server + DB + migrations (self-hosted on LAN).
  - Stores desired state and node inventory.
  - Emits operations to nodes.
- `packages/node-agent`
  - Runtime for each node (Pi or dev machine).
  - Applies state, manages cache, reports status/version/health.
- `apps/ops` (later in sequence)
  - Web UI backed by control-plane APIs.

## Registry And Secrets

Canonical public registry:
- `scripts/pis/registry.toml` (repo root) is the source of truth for node inventory.
- `cable2/scripts/pis/registry.toml` is optional compatibility/mirror input only.

Local secret overlay:
- `scripts/pis/registry.local.toml` is optional and local-only.
- Overlay rules: local values override canonical values by key where present.
- Intended for secrets or local environment-specific fields without changing the public registry.

API key policy:
- Single shared API key for all nodes.
- Preferred config source order:
  1. env `CHIBA_NODE_API_KEY`
  2. local overlay defaults (`registry.local.toml` `[defaults].api_key`)
  3. canonical registry defaults (`registry.toml` `[defaults].api_key`, if ever used)
- Per-node API keys are supported only as compatibility fallback, not required.

## Data Model (first-class resources)

Core resources:
- `media`
- `playlist`
- `block`
- `channel`
- `profile`
- `node`

Key model rules:
- `playlist` references `media` (or inline media as escape hatch).
- `block` references `playlist` (or inline legacy program list).
- `channel` references one or more `block`.
- `profile` maps nodes/groups to playback intent (channel/block/playlist/media + launch behavior).
- `node` includes capabilities and cache policy.

Apply target semantics:
- `apply media <id>`: ensure direct media intent on selected nodes (or derive temporary playlist/block/channel as internal plan artifact).
- `apply playlist <id>`: play/loop playlist intent on selected nodes.
- `apply block <id>`: resolve and apply block intent on selected nodes.
- `apply channel <id>`: apply channel intent on selected nodes.
- `apply profile <id>`: apply full multi-node intent.

## CLI Spec (phase 1)

Command shape:
- `chiba get <resource>`
- `chiba apply <resource> <id>`
- `chiba inspect <resource> <id>`
- `chiba diff <resource> <id>`
- `chiba cache <subcommand>`
- `chiba node <subcommand>`

Minimum first-pass commands:
- `chiba get media|playlists|blocks|channels|profiles|nodes`
- `chiba apply media <id> [--nodes ...] [--dry-run]`
- `chiba apply playlist <id> [--nodes ...] [--dry-run]`
- `chiba apply block <id> [--nodes ...] [--dry-run]`
- `chiba apply channel <id> [--nodes ...] [--dry-run]`
- `chiba apply profile <id> [--nodes ...] [--dry-run]`
- `chiba inspect node <id>`
- `chiba diff profile <id> [--nodes ...]`
- `chiba cache prefetch --nodes ... --from profile|channel|block|playlist|media <id>`

CLI output:
- Human-readable table by default.
- `--json` for machine use.

## Macbook-as-Node Strategy

Goal: local dev machine should act like a real node with minimal branching.

Approach:
- `node-agent` supports `--platform mac` mode.
- Run node agent locally with the same APIs as Pi node.
- Local runner options:
  - Browser-based playback runner for web/video/image.
  - Optional desktop controller mode to manage Chromium windows/tabs.
- Feature flags/capabilities advertised by node:
  - `supportsWindowManager`
  - `supportsRotation`
  - `supportsHardwareMetrics`
  - `supportsNativeKioskRestart`

VM option (optional):
- Provide a simple “virtual node” runtime profile using the same `node-agent` binary + mock hardware adapters.

## Cache/Dependency Plan

Dependency expansion lives in `packages/core`:
- Resolve transitive dependencies from apply target:
  - `profile -> channel -> block -> playlist -> media`
  - direct `channel|block|playlist|media`
- Produce deterministic cache plan per node.
- Track cache state (queued/downloading/ready/failed) per node + asset.

Node cache responsibilities:
- Receive desired cache plan.
- Download/store assets under managed cache dir.
- Report byte size, usage, and eviction decisions.

## DB and Migrations Plan

Control plane DB is Postgres-first (LAN/self-hosted via docker-compose), with file fallback for offline dev.

Initial tables:
- `media`, `playlists`, `blocks`, `channels`, `profiles`
- `nodes`, `node_capabilities`, `node_status`, `node_cache`
- `desired_state`, `apply_operations`, `apply_operation_steps`
- `artifacts` (resolved plans/snapshots)

Migration strategy:
- SQL migrations with checksum + applied-at tracking.
- Seed fixtures for local testing.

## Testing and Introspection Plan

Required from day 1:
- Unit tests for contracts/core resolution.
- API contract tests for control-plane endpoints.
- CLI integration tests against ephemeral local DB + mock node agent.
- Reconciliation tests: expected plan vs node-reported actual state.

Dev introspection:
- `chiba diff ...` and `chiba inspect node ...` are first-class.
- Persist operation logs and resolved plans for postmortem.

## Versioning and Update Confidence

Node reports:
- `agentVersion`
- `gitSha` / build metadata
- `configSchemaVersion`

Control plane exposes:
- node drift (version mismatch)
- desired-vs-actual drift
- stale nodes and failed apply operations

## Resource/RAM Awareness

Node profiles include soft limits:
- max concurrent downloads
- max cache bytes
- memory budget class

Planner considers node class/capabilities:
- conservative prefetch for low-spec Pis
- aggressive prefetch for higher-capacity nodes (e.g., dev machine)

## Delivery Phases

### Phase 0: Scaffold (now)
- Create workspace structure.
- Add shared contracts package.
- Add CLI skeleton + command parser.
- Add control-plane skeleton + migrations framework.
- Add node-agent skeleton + health endpoints.

### Phase 1: Contracts + CLI (first implementation target)
- Finalize resource schemas and validation.
- Implement `chiba get` and `chiba apply {profile|channel|block|playlist|media}`.
- Implement dry-run planning and JSON output.

### Phase 2: Control Plane + DB
- Persist resources and desired state.
- Implement apply operation lifecycle and status APIs.
- Implement dependency resolution + cache plan creation.

### Phase 3: Node Agent
- Apply desired state on node.
- Implement cache manager + status reporting.
- Macbook mode parity with Pi APIs.

### Phase 4: Reconciliation + Ops Basics
- Drift detection.
- Operation history.
- Basic ops web UI and dashboards.

### Phase 5: Hardening
- Better e2e test matrix.
- Performance tuning for low-spec Pis.
- Rollout safety controls (batching, retry/backoff, partial-failure policy).

## Remaining Work (Priority Order, updated 2026-02-11)

1) Fresh-Pi bootstrap validation (`P0`)
- Verify end-to-end bootstrap on a truly clean Pi image (Node/pnpm/systemd/services + first apply).
- Add explicit post-bootstrap health checks in script output (`systemctl is-active`, `/health` checks).
- Confirm kiosk/window-manager behavior on boot for Pi display session.

2) Laptop full-E2E smoke automation (`P0`)
- Add one command smoke script to run: start stack, apply sample target, verify desired-state + node-status.
- Include a deterministic fixture apply (`profile default` to `commander`) and assert operation status.

3) Cache materialization (`P1`)
- Current node-agent exposes cache state/prune; add actual dependency prefetch/download execution.
- Tie planner dependency graph to concrete cache jobs and report progress/failures per node.

4) Data persistence expansion (`P1`)
- Keep operations/desired-state/node-status in Postgres, then add resource tables + migrations for media/playlists/blocks/channels/profiles.
- Define import/sync path from TOML config into DB-backed resources.

5) Ops UI parity (`P1`)
- Complete ops views for desired vs actual state, operation history, and per-node health/version drift.
- Make control-plane endpoint URL configurable everywhere via env/runtime config.

6) Test matrix (`P1`)
- Add unit tests for planner/dependency expansion.
- Add integration tests for CLI apply/diff + control-plane + node-agent.
- Add bootstrap regression test harness (shell-level assertions for generated service/env files).

## Definition of Done (MVP)

MVP is done when:
- Shared contracts are used by CLI, control plane, and node agent.
- `chiba apply profile|channel|block|playlist|media` works end-to-end.
- Macbook can run node-agent and be targeted by the same apply flows.
- Cache plan is generated and enforced for applied targets.
- Desired vs actual state is inspectable from CLI.
