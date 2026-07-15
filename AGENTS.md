# Fig

Fig is a TypeScript re-implementation of React: the core ideas remain —
fibers, lanes, scheduling, diffing, rendering, hooks — while legacy cruft is
dropped and Fig-specific APIs are adopted where they are clearer.

## Documentation Map

- `docs/concepts/` — **the spec.** One file per subsystem; the single
  authoritative source for contracts, invariants, wire formats, and
  rationale. Start at `docs/concepts/README.md`; open questions and future
  plans are summarized in `docs/plans/open-questions.md`. When a change alters
  a contract, update the owning concept file in the same commit.
- `docs/` — user-facing guides; depth lives in `docs/concepts/`.
- `docs/plans/` — time-bound work plans and investigations; historical once
  shipped (shipped contracts graduate to `docs/concepts/`).

## Conventions

- The repository is hosted at https://github.com/bgub/fig (`origin`).
- Use conventional commit messages (`feat:`, `fix:`, `refactor:`, `perf:`,
  `test:`, `docs:`, `chore:`, with an optional scope like
  `fix(fig-dom): ...`).
- Add a `.tegami/<short-description>.md` changelog for changes that should ship
  in the public packages. Use Tegami's explicit frontmatter format and list the
  affected `@bgub/fig*` packages with `major`, `minor`, or `patch` bumps.

## Terminology

- **data resources** — keyed async values, cache entries, server reads, and
  the APIs that refresh or invalidate them (`docs/concepts/data.md`).
- **asset resources** — CSS, scripts, module preloads, fonts, preconnects,
  and other render-discovered assets that are deduped, loaded, and sometimes
  gated before reveal (`docs/concepts/assets.md`).
- Avoid the unqualified term "resources" where the distinction matters.
- **payload** — the server-component wire layer
  (`@bgub/fig-server/payload`). Never "RSC" or "Flight": those are React
  brands; the format is Fig's own (`docs/concepts/payload.md`).

## Design Stances (pointers, not the spec)

- Every export has one home; renderer packages never mirror core; types
  follow signatures → `docs/concepts/architecture.md`.
- Callbacks receive `AbortSignal`s, never return cleanups; the aborted
  signal is the indicator everywhere (effects, events, binds, stable events,
  transitions, actions, data loaders) → `docs/concepts/hooks.md`.
- Native DOM names and native propagation semantics, no exceptions; events
  declare via `events={[on(...)]}`; DOM access via `bind` →
  `docs/concepts/events.md`, `docs/concepts/jsx.md`.
- Explicit read verbs instead of `use(resource)`: `readContext`,
  `readPromise`, `readData` → `docs/concepts/hooks.md`, `docs/concepts/data.md`.
- Always-strict dev rendering; diagnostics throw before commit; dev behavior
  strips via compile-time `__FIG_DEV__` gates → `docs/concepts/rendering.md`.
- Server errors cross the wire only as `onError → { digest?, message? }`;
  streaming vs prerender semantics → `docs/concepts/server-rendering.md`,
  `docs/concepts/errors.md`.
