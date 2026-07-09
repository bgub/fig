# Concepts

The spec: one file per subsystem, each the single authoritative source for
that subsystem's contracts, invariants, wire formats, and rationale. Written
for someone changing the code; user guides live in `docs/`. When a contract
changes, the owning concept file updates in the same commit.

The principles every file applies: prefer small runtime concepts over
compatibility layers; keep renderer behavior explicit and host-driven; use
native platform semantics when they are clearer than React aliases; add APIs
because they strengthen Fig, not because React has them; fail early for
invalid render inputs instead of warning after commit. Non-goals: matching
React's legacy or compatibility behavior, Node-specific streams as the
default SSR surface, and adding React APIs before a Fig use case proves they
belong.

Every file carries a `Status:` line — `stable` for settled contracts,
`exploring` for open designs (Problem → Prior Art → Direction → Open
Questions → Provisional Stance).

- [open-questions.md](./open-questions.md) — every open design question and
  planned piece of work, in one place; items graduate into their owning
  concept file when resolved.
- [architecture.md](./architecture.md) — package ownership doctrine, the
  internal protocol registry, lazy data-store installation, boundaries that
  never leak.
- [rendering.md](./rendering.md) — element model, bailout tiers,
  always-strict dev rendering, pre-commit diagnostics, commit/batching.
- [hooks.md](./hooks.md) — the AbortSignal contract table, state/effects/
  stable events, transitions and actions (cancellation, last-run-wins), the
  read verbs, deliberate omissions.
- [events.md](./events.md) — `on()`/`events`, logical-tree delegation,
  native propagation (focus/blur stance), replay, `bind`.
- [jsx.md](./jsx.md) — namespace placement, `HostProps`, React-habit traps,
  the stage-2 external-package plan.
- [data.md](./data.md) — data resources: key identity, loader inputs, read
  semantics, the freshness verbs, ambient store vs explicit handle, SSR
  handoff.
- [assets.md](./assets.md) — asset resources: creators, dedupe keys,
  destinations, reveal gating.
- [templates.md](./templates.md) — compiler-extracted templates
  (experimental): the descriptor contract, slot kinds, identity, hydration
  policy, compiler eligibility.
- [server-rendering.md](./server-rendering.md) — the entry grid, streaming
  results, `prerender`, the `onError` digest contract.
- [suspense-streaming.md](./suspense-streaming.md) — markers, segments, the
  inline runtime ops.
- [activity.md](./activity.md) — visibility model, offscreen scheduling,
  hidden-template SSR and hydration.
- [view-transitions.md](./view-transitions.md) — `ViewTransition`, commit
  transactions, streamed reveal annotations.
- [hydration.md](./hydration.md) — selective hydration, event replay,
  mismatch policy, the hydration-environment exploration.
- [payload.md](./payload.md) — the server-component wire format, client
  references, boundary refreshes, terminology rule.
- [errors.md](./errors.md) — boundary contract, the recovery loop, uncaught
  routing, digests, cancellation-is-not-an-error.
- [renderer-authoring.md](./renderer-authoring.md) — HostConfig, the root
  API, the internal scheduler, dev subpaths.
