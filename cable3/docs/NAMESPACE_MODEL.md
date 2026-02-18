# Registry vs Namespace Model

## Goal

Allow both laptop (dev) and prod controller to manage/query the same nodes
without node re-bootstrap or controller lock-in.

## Terms

- `registry`: imported node inventory snapshot (from TOML or future UI).
- `namespace`: logical desired-state lane (`local`, `prod`, etc).
- `controllerId`: who wrote state (`laptop-dev`, `prod-server`, etc).

## Mapping

- `registry.local.toml` -> DB registry snapshot `local`
- `registry.prod.toml` -> DB registry snapshot `prod`

Registries are inventory source metadata, not runtime truth. Runtime truth is
desired state + active state on node, scoped by namespace.

## Practical Rules

1. Node remains controller-neutral.
2. Any trusted controller can query node status.
3. Any trusted controller can apply desired state with:
   - namespace
   - controllerId
   - expectedRevision
4. Node tracks revision per namespace and returns conflicts explicitly.

## Why this helps

- Laptop and prod can both operate without rewriting node config.
- No silent takeover: conflicting writes in same namespace are detected.
- Clear rollback/switching by namespace policy.

## Near-term default policy

- Active namespace defaults to `prod`.
- Dev/testing uses explicit `--namespace local`.
- Ops UI displays both desired/active revisions and active namespace.
