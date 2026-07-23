# Concepts

Status: stable index

This folder is Fig's spec. Each file owns one subsystem: its public contract, important invariants, wire formats, and the reasoning behind them. The guides one directory up explain how to use Fig; these files explain what Fig promises.

When a code change alters a contract, update the matching concept file in the same commit.

## How To Read These Docs

Every file has a status:

- `stable` means the contract is settled.
- `exploring` means the design is still open. These files should explain the problem, prior art, likely direction, and remaining questions.
- A qualified status describes a file with both settled and open parts.

Across the project, we prefer a small number of explicit runtime concepts over compatibility layers. We use native platform behavior when it is clearer than a React alias and keep renderer behavior host-driven.

Invalid render input fails before commit. React parity alone is not a reason to add an API.

Fig does not aim to preserve React's legacy behavior, make Node-specific streams the default SSR API, or add compatibility APIs before a real Fig use case needs them.

Open work that spans several subsystems lives in [open-questions.md](../plans/open-questions.md). Once a decision is made, its contract belongs in the concept file that owns it.

## Map

- [Architecture](./architecture.md) — package ownership, internal protocols, and boundaries that stay private.
- [Rendering](./rendering.md) — elements, fibers, bailouts, strict development rendering, diagnostics, and commit.
- [Hooks](./hooks.md) — state, effects, stable events, transitions, actions, read verbs, and the shared `AbortSignal` contract.
- [Host mixins](./mixins.md) — render-time host behavior composition.
- [Events](./events.md) — `on()`, native propagation, logical-tree delegation, replay, and `bind`.
- [JSX](./jsx.md) — renderer-owned JSX types and native host props.
- [Data resources](./data.md) — keys, stores, reads, freshness, and SSR handoff.
- [Asset resources](./assets.md) — asset declarations, deduplication, placement, and reveal gating.
- [Server rendering](./server-rendering.md) — streaming APIs, prerendering, errors, and flow control.
- [Suspense streaming](./suspense-streaming.md) — boundary markers, streamed segments, and browser operations.
- [Activity](./activity.md) — hidden trees, offscreen work, SSR, and hydration.
- [View transitions](./view-transitions.md) — declarative transition surfaces and commit coordination.
- [Hydration](./hydration.md) — selective hydration, event replay, mismatch recovery, and environment-stable rendering.
- [Payload](./payload.md) — Fig's server-component data format and client references.
- [Errors](./errors.md) — boundaries, recovery, uncaught errors, digests, and cancellation.
- [Renderer authoring](./renderer-authoring.md) — `HostConfig`, renderer roots, and the scheduler.
- [TanStack Router](./tanstack-router.md) — the Router Core adapter and route-data contract.
- [TanStack Start](./tanstack-start.md) — request rendering, shared data ownership, Payload routes, and build integration.
- [Intentional differences from React](./intentional-differences-from-react.md) — a quick orientation for React users.
