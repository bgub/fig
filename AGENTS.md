# Fig

Fig is a TypeScript re-implementation of React: the core ideas remain —
fibers, lanes, scheduling, diffing, rendering, hooks — while legacy cruft is
dropped and Fig-specific APIs are adopted where they are clearer.

## Documentation Map

- `concepts/` — **the spec.** One file per subsystem; the single
  authoritative source for contracts, invariants, wire formats, and
  rationale. Start at `concepts/README.md`. When a change alters a contract,
  update the owning concept file in the same commit.
- `docs/` — user-facing guides (`intentional-differences-from-react.md` is
  the React-migrant orientation; depth lives in concepts).
- `plans/` — time-bound work plans and investigations; historical once
  shipped (shipped contracts graduate to concepts).

## Conventions

- The repository is hosted at https://github.com/bgub/fig (`origin`).
- Use conventional commit messages (`feat:`, `fix:`, `refactor:`, `perf:`,
  `test:`, `docs:`, `chore:`, with an optional scope like
  `fix(fig-dom): ...`).

## Terminology

- **data resources** — keyed async values, cache entries, server reads, and
  the APIs that refresh or invalidate them (`concepts/data.md`).
- **asset resources** — CSS, scripts, module preloads, fonts, preconnects,
  and other render-discovered assets that are deduped, loaded, and sometimes
  gated before reveal (`concepts/assets.md`).
- Avoid the unqualified term "resources" where the distinction matters.
- **payload** — the server-component wire layer
  (`@bgub/fig-server/payload`). Never "RSC" or "Flight": those are React
  brands; the format is Fig's own (`concepts/payload.md`).

## Design Stances (pointers, not the spec)

- Every export has one home; renderer packages never mirror core; types
  follow signatures → `concepts/architecture.md`.
- Callbacks receive `AbortSignal`s, never return cleanups; the aborted
  signal is the indicator everywhere (effects, events, binds, stable events,
  transitions, actions, data loaders) → `concepts/hooks.md`.
- Native DOM names and native propagation semantics, no exceptions; events
  declare via `events={[on(...)]}`; DOM access via `bind` →
  `concepts/events.md`, `concepts/jsx.md`.
- Explicit read verbs instead of `use(resource)`: `readContext`,
  `readPromise`, `readData` → `concepts/hooks.md`, `concepts/data.md`.
- Always-strict dev rendering; diagnostics throw before commit; dev behavior
  strips via inline `NODE_ENV` gates → `concepts/rendering.md`.
- Server errors cross the wire only as `onError → { digest?, message? }`;
  streaming vs prerender semantics → `concepts/server-rendering.md`,
  `concepts/errors.md`.
