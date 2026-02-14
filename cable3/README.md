# cable3

`cable3` is the next clean implementation track for Chiba display orchestration.

This directory starts with planning and architecture first. No runtime behavior
should be assumed from `cable3` until implementation milestones are completed.

## Purpose

- Make nodes thin, deterministic clients.
- Centralize resolution and intent in the control plane.
- Enforce contracts end-to-end to eliminate ambiguous runtime behavior.
- Ship reliable operations tooling for cache/state/performance introspection.

## Current Status

- Phase: Planning
- Main document: `cable3/PLAN.md`

## Scope Notes

- `cable2` remains the active runtime while `cable3` is built and validated.
- `cable3` should only replace `cable2` after passing cutover gates in `PLAN.md`.
