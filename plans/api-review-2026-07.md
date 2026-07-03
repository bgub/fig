# Fig API Review — React-isms and Unwise Decisions (July 2026)

Synthesis of a five-reviewer audit across `fig`, `fig-server`, `fig-dom`, `fig-reconciler`, `fig-scheduler`, and `fig-data`, evaluating every public API against Fig's philosophy: keep React's modern model, drop legacy cruft, adopt Fig-specific APIs where clearer.

The short version: **the original Fig ideas are consistently better than their React counterparts — the real problems are places where Fig invented a better idiom and then didn't apply it to its own APIs, plus one cloned package (the scheduler) and one borrowed brand (RSC) that were carried over wholesale.** Findings ranked by how much they matter.

## Tier 1 — Philosophy contradictions (Fig breaking Fig's own rules)

**1. The AbortSignal contract stops at exactly the APIs that need it most.** Effects, `bind`, DOM events, reactive events, and data loaders all receive a signal — but `useTransition` callbacks and `useActionState` actions (`hooks.ts:12-28`), the two async-workflow primitives copied structurally from React 19, get nothing. A superseded async action can't cancel its fetch, which is the exact problem the signal contract exists to solve. `useActionState` is also literally a reducer (`(prev, ...args) => next`) in a library whose stated position is "no useReducer" — its honest justification is the async/pending integration, and that justification only holds if it gets the signal. This is the purest "kept React's shape out of habit" finding because the better idiom already exists in the same file.

**2. fig-data's mutation APIs are dispatcher-isms applied to non-render code — and the canonical pattern throws.** `invalidateData`/`refreshData`/`preloadData` are free functions resolving an ambient store slot that's set during render, event dispatch, and only the _synchronous prefix_ of actions (the `.then` continuation at `fig-reconciler/src/index.ts:2150` isn't re-wrapped; effects never set it). So `await api.save(); invalidateData(post, id)` — the single most common mutation flow — throws "Data resource APIs require a Fig data store" at runtime. `readData` genuinely belongs to the render dispatcher; store mutations don't. The fix is Fig-philosophy-shaped: put these on `FigDataStoreHandle` (an explicit handle) and/or capture the store synchronously. The demos only work because they call these before the first `await`.

**3. The error-recovery story doesn't compose end to end.** Three findings that are individually small and jointly a wall:

- `ErrorBoundary`'s `fallback` is a static node — the error is only visible via the `onError` side channel (`element.ts:81-85`), so an error UI can't render the message or offer retry without smuggling state above the boundary.
- `invalidateData` on a rejected entry clears staleness but not the rejection (`store.ts:404-421`), so the documented reset path — remount the boundary — re-reads the poisoned entry and re-throws immediately. You must know to `refreshData` first, which itself needs the ambient store (#2). There are zero rejected-entry tests in fig-data's suite.
- Net effect: "data fetch failed, show error, user clicks retry" — the most basic resilient-UI loop — currently requires three pieces of undocumented plumbing. Fix as one unit: `fallback?: FigNode | ((error, info) => FigNode)`, and make `invalidateData` reset rejected entries to pending.

**4. There are no JSX host-prop types.** Every app hand-writes `[name: string]: Record<string, unknown>` (`apps/demo-client/src/jsx.d.ts`). This means Fig's flagship departures are all unenforced: `className="x"` typechecks (and silently renders a useless `classname` attribute with no dev warning — the one habit-migration case the otherwise-excellent warning machinery misses), `events={onClick}` typechecks, `bind` can't infer the element type. That last one stings most: Fig's design uniquely enables `bind={(node: HTMLInputElement) => ...}` inference with zero `forwardRef` gymnastics — a headline advantage over React that's currently invisible. This is the highest-leverage single investment on the list.

**5. The RSC layer wears React's brand on the wire.** The entry point, types, header (`x-fig-rsc-boundary`), id prefixes, and even the MIME type (`text/x-component` — React Flight's unregistered type, for a format that isn't Flight) all say "RSC." Renaming after stabilization is a wire break, so this is a now-or-never decision. (The error-leak half of this finding is fixed: RSC renders now take the same `onError → {digest?, message?}` contract as the HTML renderer.)

## Tier 2 — React carried over wholesale

**fig-scheduler is a cloned `scheduler` package, ~40% dead.** `runWithPriority`/`getCurrentPriorityLevel` (written, read by nobody — Fig tracks `currentUpdateLane` itself), `requestPaint`/`forceFrameRate` (never called, so the `needsPaint` half of the yield heuristic can never fire), the entire delayed-task timer queue (~a third of the implementation; Fig uses retry lanes instead), and a parallel `createScheduler` instance API next to the singleton the reconciler hard-imports. It has one consumer and no reason to be a published package — fold it into fig-reconciler. There's also one bug-grade item: the module-scope singleton creates a `MessageChannel` at import time whose ref'd port keeps Node processes alive — the same bug React fixed (facebook/react#20756) by preferring `setImmediate`; Fig's fallback chain is missing that branch, and the code's own `dispose()` comment acknowledges the hazard. Any Node consumer that transitively imports fig-dom inherits it; vitest masks it by force-killing workers.

**focus/blur bubbling emulation is the one synthetic-event behavior Fig kept.** Fig correctly refused `mouseenter` emulation and `onChange` remapping, but natively non-bubbling `focus`/`blur` bubble through the Fig tree via capture delegation — while `focusin`/`focusout` (the native bubbling variants) also work. A native-DOM-literate user gets non-native behavior with no API-surface hint. Defensible for portal-crossing semantics, but it should be a documented decision or dropped; right now it's inherited.

**Naming and surface habit-isms**, roughly in order of conviction:

- `useReactiveEvent` — the name inverts the semantics; the project's own docs call it the "non-reactive event hook." `useEvent` or `useStableEvent`.
- `renderToString` — the name promises react-dom/server semantics but the behavior is "buffer the stream," so suspended trees yield fallbacks, staging divs, and inline scripts in the "string." Either make it a true settle-then-emit `prerender` (clean HTML, no runtime scripts — genuinely useful for SSG/emails) or rename it honestly. Relatedly, `onShellError` duplicates the rejecting `shellReady` promise — React needed the callback only for its Node-callback API; Fig has the promise, drop the callback.
- `Dispatch<SetStateAction<S>>` — reducer vocabulary in a library that deleted reducers; one `StateSetter<S>` type is clearer.
- `render(children, container)` on the reconciler's public return — a pre-React-18 shape that exists for the reconciler's own tests; move to a test helper. Same for exported-but-unconsumed `getCurrentUpdatePriority` and fig-dom's public `batchedUpdates` (React 17 legacy; auto-batching makes it cargo-cult bait).
- `FigChild`/`FigNode` are the same type under two names — React deprecated that distinction itself; export only `FigNode`.
- The "internal" types that every framework integration must import: `FigDataHydrationEntry` and `FigDataStoreHandle` appear in public root/server signatures but are only nameable via `@bgub/fig/internal` — fig-start already imports them there. Types referenced by public APIs are public; promote them so they get semver protection.

## Decisions to make explicitly rather than inherit

These aren't wrong, but they're currently accidents rather than choices, and each will surprise someone after the API freezes:

- **Controlled inputs**: Fig's actual semantics are "value is authoritative at commit time," not React's synchronous post-event lock — arguably _more_ coherent with native events, but undocumented, and the `value` prop currently also syncs the `value` _attribute_ (i.e. `defaultValue`) on every commit, which React deliberately doesn't do. Pick the model, document it, fix the attribute wart.
- **`events` array identity**: conditional entries (`isOpen && on(...)`) throw, while `composeBind` accepts them — accept falsy holes and document that array position is a listener's identity. Also `once` slots tombstone forever under a stable declaration; document or drop `once`.
- **Numeric style values** silently produce nothing (no px auto-suffix — right call — but also no dev warning, while string styles _do_ warn).
- **No hydration-mismatch opt-out**: intentional server/client divergence (timestamps, locales) currently has no per-element escape hatch — decide whether that's a stance or a gap.
- **`TStoreContext`** rides as an uninferrable phantom on every fig-data signature backed by an unchecked cast from `dataContext: unknown` — a Register-style module augmentation (fig-start already uses the pattern) would delete it from every signature.

## What's genuinely better than React (leave alone)

Worth saying explicitly, because the answer to the headline question is mostly "no" at the core: the read-verb split (`readContext`/`readPromise`/`readData`), signal-based effects with the `undefined`-return trick that makes React-style cleanups a type error, the asset-resource creators (better than React 19 hoistables — plain data, explicit dedupe keys), `lazy` without the `{default}` unwrap, `unsafeHTML` as a plain scary-named string, native `class`/`for`, the `onChange→on("input")` steering warning, the HostConfig (a real cleanup of react-reconciler: 6 required methods, runtime-enforced capability groups, no mode flags, parent-passed instead of context-stack — and no lanes or fibers leak into any public contract), the fig-data key encoder (fixes react-query's silent JSON.stringify traps), the deliberately narrow invalidate/refresh verb set, and the synchronous stream-result object with `shellReady`/`allReady`. The deps arrays on `useMemo`/effects are also the honest choice without a compiler — that's not a habit-ism.

## Sequencing

The RSC `onError` leak and the scheduler Node-liveness bug are straightforward fixes; the signal-for-actions contract, the ErrorBoundary/invalidateData recovery loop, the fig-data store-handle mutations, and the RSC naming are the ones to settle **before** anything freezes, because they're all either wire formats or call-signature contracts; JSX types are the biggest single ergonomics investment; the scheduler prune and naming cleanups can trail.
