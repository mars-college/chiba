# cable3 Comprehensive Plan

## 1. Problem Statement

The current system has grown multiple overlapping control paths and runtime
assumptions. This causes non-deterministic behavior under stress:

- Apply requests can succeed while visible output does not change.
- Display runtime can drift (query args vs server state vs node local state).
- Cache readiness and playback readiness are not represented as a single source
  of truth.
- Type contracts are not consistently enforced (`as any` in critical paths).
- Bootstrap cannot guarantee a predictable healthy baseline on every node.

`cable3` is a clean implementation that fixes these at architectural boundaries.

## 2. Design Principles

1. Thin nodes:
Node resolves as little as possible and executes explicit control-plane intent.

2. Single authoritative state:
One desired state model per screen, versioned by revision.

3. Deterministic activation:
Node only switches visible output when next target is ready (or policy says
degrade/fallback).

4. Contract-first:
All major payloads and events are typed and validated at boundaries.

5. Observable by default:
Every apply and every transition must be introspectable from CLI and Ops UI.

6. Bootstrap-to-healthy:
Bootstrap must enforce an explicit healthy target state, not "best effort."

7. Controller neutrality:
Nodes must not hard-bind to a single controller address; both dev and prod
controllers must be able to query and apply state safely.

## 3. Canonical Content Model

This is the canonical semantic model and must be used everywhere:

- media: atomic playable/displayable item.
- playlist: ordered collection of media and/or nested playlists.
- block: time-constrained composition of media/playlists with loop/repeat rules.
- channel: 24h schedule composed from blocks.
- profile: assignment policy that applies any target kind to selected nodes.

The resolver must not force channel ownership for media/playlist/block targets.

## 4. Target Architecture

### 4.1 Core Services

1. Control Plane API:
- Stores desired state.
- Resolves targets into render manifests.
- Tracks apply operations and per-node acknowledgements.

2. Resolver Service:
- Input: target reference and policy overrides.
- Output: fully resolved `RenderManifestV1` with media graph, display metadata,
  infobox metadata, and cache requirements.

3. Node Agent Runtime:
- Polls/subscribes for desired state revision.
- Fetches manifest and warms dependencies.
- Activates renderer when ready.
- Emits heartbeat and active runtime state.

4. Ops API/UI:
- Operates only via desired state operations.
- Visualizes desired vs active revision and blocker reasons.

### 4.3 Multi-Controller Topology (dev + prod safe)

`cable3` must support multiple controllers interacting with the same nodes
without rewriting node config each time.

Rules:

- Node is controller-neutral by default.
- Node exposes authoritative local status/state endpoints that any trusted
  controller can read.
- State mutation uses explicit tenancy/namespace and operation metadata to avoid
  accidental cross-environment clobbering.
- Controller identity is part of operation records (`controllerId`,
  `environment`, `operationId`).

Recommended model:

- Node keeps a local desired/active state store keyed by environment namespace.
- Controllers apply into their namespace (e.g. `dev`, `prod`).
- Active namespace on node is switchable policy (`preferredNamespace`) and can
  be overridden explicitly per apply operation.
- Query endpoints can return:
  - all namespaces
  - current active namespace
  - desired/active revisions per namespace

Conflict handling:

- Last-writer-wins is not sufficient.
- Apply must include expected base revision (optimistic concurrency).
- Node rejects conflicting writes with structured conflict error and current
  revision metadata.

### 4.2 Runtime Backends

Node runtime supports two renderer backends:

- `chromium` backend for guide/web and interactive surfaces.
- `mpv` backend for cached media playback.

Runtime manager selects backend by manifest item type and policy. Backend switch
must be explicit, observable, and fast-fail with fallback messaging.

## 5. Contract Set (Required)

All of these must be defined in a shared contracts package and used by server,
node, ops, and CLI:

1. `DesiredScreenStateV1`:
- screenId
- revision
- target `{kind,id}`
- launch options (strict enum + typed fields)
- policy flags (prefetch, activation strategy, degrade policy)

2. `RenderManifestV1`:
- manifestId
- screenId
- revision
- resolved target
- ordered playables with source descriptors
- per-item metadata (artist/title/description)
- cache plan (required artifacts)
- renderer hints (rotation/aspect/mode)

3. `NodeRuntimeReportV1`:
- nodeId/screenId
- desired revision
- active revision
- phase (`idle|warming|ready|activating|active|degraded|error`)
- current item and elapsed
- cache progress summary
- error code + message + retry state

4. `ApplyOperationV1`:
- operationId
- requested target + node list
- per-node status
- timestamps
- user-facing errors

No unvalidated `any` payload is allowed on these boundaries.

## 6. Launch Option Rationalization

Current launch args are redundant and conflicting. `cable3` defines one schema:

- `mode`: `guide|gallery`
- `targetKind`: `media|playlist|block|channel`
- `targetId`: string
- `lock`: boolean
- `qr`: boolean
- `nosplash`: boolean
- `hudMode`: `always|start|never`
- `hudSec`: number
- `theme`: string
- `displayRotate`: `0|90|180|270`

Deprecated and removed from primary control surface:

- `gallery` (redundant with mode)
- `playlist` (redundant with target kind)
- free-form fallback aliases except compatibility parsing in migration shims

## 7. Data and Caching Strategy

### 7.1 Resolution Ownership

- Resolver runs on control plane.
- Nodes consume only resolved manifests and signed source refs.
- Nodes do not parse global catalog files during normal runtime.

### 7.2 Cache Guarantees

- Every manifest includes explicit `requiredArtifacts`.
- Node warming phase resolves each artifact state:
  `missing|fetching|ready|failed`.
- Activation policy:
  - `strict`: switch only when all required artifacts are ready.
  - `best_effort`: switch when minimum threshold reached.

### 7.3 Timeouts and Retries

- Configured per source class (`nas`, `remote_url`, `eden`).
- Exponential backoff with max attempt cap.
- Failure escalates to explicit degraded state with exact failing artifact ids.

## 8. Node Runtime State Machine

Single finite state machine per screen:

1. `idle`
2. `warming`
3. `ready`
4. `activating`
5. `active`
6. `degraded`
7. `error`

Transition rules:

- Any new desired revision preempts old warming/activation.
- Activation is atomic (previous render remains visible until switch commit).
- Post-activation validation confirms output backend and active item.

## 9. Bootstrap and Health Baseline

Bootstrap becomes a deterministic convergence operation:

1. Stop conflicting services.
2. Install/verify exact runtime dependencies.
3. Install unit files from versioned templates.
4. Validate ports are free/owned by expected services.
5. Validate node-agent health endpoint.
6. Validate renderer backend smoke test.
7. Persist "bootstrap success stamp" with commit + timestamp.

Bootstrap fails hard if any required health checks fail.

## 10. Observability and Tooling

### 10.1 CLI

Introduce/expand commands:

- `chiba doctor node <id>`:
  must show desired revision, active revision, cache progress, current item,
  backend, and blockers.
- `chiba doctor fleet`:
  aggregate health and drift matrix.
- `chiba cache status <id> --target <kind:id>`
- `chiba cache warm <id> --target <kind:id>`
- `chiba runtime tail <id>`
- `chiba namespace ls <id>`
- `chiba namespace set <id> <name>`

### 10.2 Ops UI

Per node row shows:

- desired vs active target
- desired vs active revision
- runtime phase
- cache progress (`ready/total`)
- first error (if any)
- backend (`chromium|mpv`)

Apply result is not "success" until node acknowledges active revision.

### 10.3 Declarative Application API (kubectl-style, agent-usable)

`cable3` must expose a declarative API that works for both humans and agents
without UI coupling.

Resource model (initial):

- `ScreenAssignment`
- `ProfileAssignment`
- `CacheWarmRequest`
- `NodeRuntimePolicy`

Core API semantics:

- `apply`: declarative upsert with idempotency and revision conflict handling.
- `get`: fetch current desired/observed state for one or many resources.
- `describe`: expanded state with blockers, events, and last transition errors.
- `diff`: server-side preview of changes before apply.
- `delete`: remove desired assignment cleanly with fallback behavior.
- `watch`: stream status/events until target condition is met.

Agent requirements:

- Fully structured JSON responses and machine-readable error codes.
- Stable operation ids and correlation ids on every mutating request.
- Condition model like:
  `Accepted`, `ManifestResolved`, `Warming`, `Ready`, `Activated`, `Degraded`.
- `wait` semantics by condition and timeout (API + CLI parity).
- Safe retries: same request id must not duplicate side effects.
- Dry-run mode for planning and tool-based reasoning.
- Namespace-aware operations and explicit controller identity fields.

CLI parity goals:

- `chiba apply -f assignment.toml --wait=Activated`
- `chiba get screenassignment <id> -o json`
- `chiba describe node <id>`
- `chiba diff -f assignment.toml`
- `chiba watch screen <id>`
- `chiba apply -f assignment.toml --namespace=dev --controller-id=laptop`

## 11. Phased Execution Plan

## Phase 0: Freeze and Boundaries (1-2 days)

Deliverables:

- Mark `cable2` as maintenance-only.
- Freeze new launch-param additions.
- Write compatibility map from old params to new schema.
- Document current service/unit ownership and conflict rules.

Exit Criteria:

- No new behavior paths added to `cable2`.
- Agreed target schema and runtime ownership documented.

## Phase 1: Contracts and Validation (2-3 days)

Deliverables:

- Add `DesiredScreenStateV1`, `RenderManifestV1`, `NodeRuntimeReportV1`,
  `ApplyOperationV1` in shared contracts.
- Validate request/response payloads on server and node boundaries.
- Introduce typed parser adapters where legacy payloads still exist.

Exit Criteria:

- End-to-end typed path for apply -> desired state write -> node report.
- No untyped boundary for new cable3 APIs.

## Phase 2: Control Plane Resolver (3-5 days)

Deliverables:

- Resolver service that compiles target into render manifest.
- Explicit dependency graph and required artifact set.
- Deterministic infobox precedence rules (target-level overrides).

Exit Criteria:

- Same input target yields same manifest hash.
- Resolver test suite covers media/playlist/block/channel/profile cases.

## Phase 3: Thin Node Runtime Manager (4-6 days)

Deliverables:

- Node state machine implementation.
- Backend adapter layer (`chromium`, `mpv`).
- Atomic revision activation.
- Warming progress and blocker reporting.

Exit Criteria:

- Node can switch targets repeatedly without stale content lock-in.
- Active revision always reflects visible content.

## Phase 4: Cache Pipeline Hardening (3-5 days)

Deliverables:

- Artifact fetch workers with retries/timeouts.
- Source-class specific policies.
- Cache integrity checks and resume support.

Exit Criteria:

- Reliable warm/activate behavior under partial network failures.
- Clear degraded status instead of silent stalls.

## Phase 5: Ops + Doctor UX (3-4 days)

Deliverables:

- Ops reflects desired/active revision and cache state.
- CLI doctor commands aligned with same backend state.
- Filterable node table and actionable blocker drill-down.

Exit Criteria:

- Apply diagnostics are one-click / one-command actionable.

## Phase 6: Bootstrap V2 (2-4 days)

Deliverables:

- New bootstrap script converging to cable3 runtime.
- Full service conflict handling.
- Post-bootstrap verification gate.

Exit Criteria:

- Fresh node reaches healthy state without ad-hoc manual fixes.

## Phase 7: Cutover and Rollback (2-3 days)

Deliverables:

- Canary rollout plan.
- Rollback mechanism to previous runtime mode.
- Cutover checklist and runbook.

Exit Criteria:

- Controlled migration with no blind switching.

## 12. Testing Strategy

1. Contract tests:
schema compatibility and strict parsing.

2. Resolver tests:
graph correctness, dependency closure, infobox precedence.

3. Node runtime tests:
state machine transitions, preemption, activation atomicity.

4. Integration tests:
apply target -> desired state -> manifest -> warm -> active revision ACK.

5. Chaos tests:
power loss, network drop, partial cache corruption, slow NAS.

6. Performance tests:
cache warm latency, memory footprint, frame stability, switch time.

### 12.1 Local Node Expectations Harness (required)

`cable3` must be testable against a local node runtime with explicit
expectations and deterministic pass/fail outcomes.

Harness requirements:

- A local node mode that can run on laptop (`desktop`) and headless (`sim`).
- Scenario files that define:
  desired target, expected transitions, timing bounds, and expected active item.
- Assertions for:
  desired revision accepted, cache warm progress, activation completion, backend
  selected, and no stale-content lock.
- Golden event timeline checks (expected ordered state transitions).
- Failure injection toggles (network outage, NAS timeout, corrupted artifact,
  control-plane disconnect) with expected degraded behavior.
- One-command test entrypoint, for example:
  `chiba test scenario ./scenarios/playlist_switch.yaml`.

Minimum release gate:

- No release if local-node scenario suite fails.
- Must include at least:
  media apply, playlist apply, rapid target switch preemption, cold-cache warm,
  warm-cache activation, and outage recovery cases.

## 13. Laptop-as-Node Development Mode

Required modes:

1. `desktop` mode:
run node-agent and runtime manager on laptop with local cache and windowed render.

2. `sim` mode:
headless fake renderer for CI and state-machine verification.

3. `vm` mode (optional):
Linux image with near-Pi service topology for bootstrap/systemd testing.

Goal: full introspection without needing a physical Pi for every debug cycle.

## 14. Resilience Requirements

1. Power outage recovery:
- Node resumes with last desired revision and restarts warming if needed.

2. Internet outage:
- Already-cached content continues playing.
- Node reports degraded external fetch state, not hard failure.

3. Control plane outage:
- Node continues active manifest.
- Reconciles desired revision when control plane returns.

4. NAS outage:
- Use cached artifacts and explicit degraded status.

5. Dual-controller operation:
- Node remains queryable and mutable from both laptop and prod controller.
- Namespace separation prevents accidental cross-environment takeover.
- If both controllers write same namespace concurrently, conflicts are explicit
  and deterministic.

## 15. Future Product Phase (Post-Stability)

After runtime stabilization:

- Media manager UI
- Upload/index workflow for NAS content
- Eden collection ingestion jobs
- Playlist/block/channel/profile editor UI
- User-facing scheduling and apply workflows
- Config files become import/export, not primary authoring path

## 16. Immediate Next Actions

1. Create `cable3` packages:
- `packages/contracts`
- `packages/resolver`
- `packages/node-runtime`
- `apps/control-api`

2. Implement and lock V1 contract schemas.

3. Implement resolver MVP returning `RenderManifestV1` for one target.

4. Implement node runtime FSM with mocked backend and revision ACK.

5. Wire one end-to-end apply operation through new cable3 path in parallel with
   existing cable2, behind a feature flag.

6. Define `ScreenAssignment` resource schema and implement `apply/get/diff/watch`
   API endpoints with structured condition reporting.

7. Build local-node expectations harness and commit initial scenario suite used
   as pre-merge CI gate.

8. Implement namespace-aware node state store and controller identity metadata
   on all mutating operations.

---

This plan is intentionally strict on boundaries. The objective is to remove
runtime ambiguity, make failures explicit, and make operations predictable under
time pressure.
