# Fig API Review — React-isms and Unwise Decisions (July 2026)

Synthesis of a five-reviewer audit across `fig`, `fig-server`, `fig-dom`, `fig-reconciler`, `fig-scheduler`, and `fig-data`, evaluating every public API against Fig's philosophy: keep React's modern model, drop legacy cruft, adopt Fig-specific APIs where clearer.

The short version: **the original Fig ideas are consistently better than their React counterparts — the real problems are places where Fig invented a better idiom and then didn't apply it to its own APIs, plus one cloned package (the scheduler) and one borrowed brand (RSC) that were carried over wholesale — both since resolved.** Findings ranked by how much they matter.

## Tier 1 — Philosophy contradictions (Fig breaking Fig's own rules)

**1. The AbortSignal contract stops at exactly the APIs that need it most.** Effects, `bind`, DOM events, reactive events, and data loaders all receive a signal — but `useTransition` callbacks and `useActionState` actions (`hooks.ts:12-28`), the two async-workflow primitives copied structurally from React 19, get nothing. A superseded async action can't cancel its fetch, which is the exact problem the signal contract exists to solve. `useActionState` is also literally a reducer (`(prev, ...args) => next`) in a library whose stated position is "no useReducer" — its honest justification is the async/pending integration, and that justification only holds if it gets the signal. This is the purest "kept React's shape out of habit" finding because the better idiom already exists in the same file.

**2. There are no JSX host-prop types.** Every app hand-writes `[name: string]: Record<string, unknown>` (`apps/demo-client/src/jsx.d.ts`). This means Fig's flagship departures are all unenforced: `className="x"` typechecks (and silently renders a useless `classname` attribute with no dev warning — the one habit-migration case the otherwise-excellent warning machinery misses), `events={onClick}` typechecks, `bind` can't infer the element type. That last one stings most: Fig's design uniquely enables `bind={(node: HTMLInputElement) => ...}` inference with zero `forwardRef` gymnastics — a headline advantage over React that's currently invisible. This is the highest-leverage single investment on the list.

## Tier 2 — React carried over wholesale

**Naming and surface habit-isms**, roughly in order of conviction:

- `useReactiveEvent` — the name inverts the semantics; the project's own docs call it the "non-reactive event hook." `useEvent` or `useStableEvent`.
- `renderToString` — the name promises react-dom/server semantics but the behavior is "buffer the stream," so suspended trees yield fallbacks, staging divs, and inline scripts in the "string." Either make it a true settle-then-emit `prerender` (clean HTML, no runtime scripts — genuinely useful for SSG/emails) or rename it honestly. Relatedly, `onShellError` duplicates the rejecting `shellReady` promise — React needed the callback only for its Node-callback API; Fig has the promise, drop the callback.
- `render(children, container)` on the reconciler's public return — a pre-React-18 shape that exists for the reconciler's own tests; move to a test helper. Same for exported-but-unconsumed `getCurrentUpdatePriority` and fig-dom's public `batchedUpdates` (React 17 legacy; auto-batching makes it cargo-cult bait).

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

Done so far: the payload layer in full (the `onError` leak, then the RSC brand renamed away: `@bgub/fig-server/payload`, `renderToPayloadStream`/`createPayloadResponse`/`fetchPayload`/`PayloadBoundary`, `text/x-fig-payload` MIME, `x-fig-payload-boundary` header, `fig-pl-` id prefixes, and structured `{ id, exportName? }` client-reference metadata replacing client-side `#` parsing), the fig-data store-handle mutations (`root.data` + `readDataStore()`, effects run in the ambient store), the error-recovery loop (function `fallback` receives the error; `invalidateData` resets rejected entries), the scheduler in full (Node-liveness fix, dead-surface prune, commit → `requestPaint` wiring, folded into fig-reconciler as an internal module — the published `@bgub/fig-scheduler` package is gone), and the focus/blur decision: the React-style bubbling emulation is deleted — all non-bubbling events attach directly with native semantics, and ancestor focus tracking uses `focusin`/`focusout`. Next: the signal-for-actions contract is the one to settle **before** anything freezes (a call-signature contract); JSX types are the biggest single ergonomics investment; the naming cleanups can trail.
