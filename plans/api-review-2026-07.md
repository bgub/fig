# Fig API Review — React-isms and Unwise Decisions (July 2026)

Synthesis of a five-reviewer audit across `fig`, `fig-server`, `fig-dom`, `fig-reconciler`, `fig-scheduler`, and `fig-data`, evaluating every public API against Fig's philosophy: keep React's modern model, drop legacy cruft, adopt Fig-specific APIs where clearer.

The short version: **the original Fig ideas are consistently better than their React counterparts — the real problems are places where Fig invented a better idiom and then didn't apply it to its own APIs, plus one cloned package (the scheduler) and one borrowed brand (RSC) that were carried over wholesale — both since resolved.** Findings ranked by how much they matter.

## Tier 1 — Philosophy contradictions (Fig breaking Fig's own rules)

All Tier-1 findings are resolved.

## Tier 2 — React carried over wholesale

**Naming and surface habit-isms**, roughly in order of conviction:

- Stage-2 JSX attribute typing: replace `HostProps`' open attribute index with a closed vocabulary from an **externally-maintained attribute package** (decision: do not hand-curate) for typo protection — which also removes the union-typed index (so `title={<div/>}` stops passing). Learned from a hand-curated prototype: a first-cut list misses real attributes immediately (`lang`, `charset`, `open`, `colspan`, `srcset`, ...), and SVG/MathML-only tags likely keep an open index — their vocabulary is huge and camelCase-heavy (`viewBox`, `cx`, `preserveAspectRatio`). Whatever package is chosen must use native attribute names (`class`, `for`, kebab-case), not React's.
- Done: a true `prerender(node)` mode holds flushing until `allReady` so boundaries complete in place and the output is settled, script-free HTML (SSG/emails). `renderToHtml` remains the buffered streamed wire format.

## Decisions to make explicitly rather than inherit

These aren't wrong, but they're currently accidents rather than choices, and each will surprise someone after the API freezes:

- Done: **controlled inputs** use the explicit Fig model: `value` is authoritative at commit time and controls only the live DOM value; `defaultValue` owns the default value/HTML representation. Fig does not emulate React's synchronous post-event lock.
- **`events` array identity**: conditional entries (`isOpen && on(...)`) throw, while `composeBind` accepts them — accept falsy holes and document that array position is a listener's identity. Done: the ambiguous declarative `once` option was dropped from Fig event options.
- Done: **numeric style values** still do not get a React-style px auto-suffix, but development builds now warn when they are ignored.
- **No hydration-mismatch opt-out**: intentional server/client divergence (timestamps, locales) currently has no per-element escape hatch — decide whether that's a stance or a gap.
- **`TStoreContext`** rides as an uninferrable phantom on every fig-data signature backed by an unchecked cast from `dataContext: unknown` — a Register-style module augmentation (fig-start already uses the pattern) would delete it from every signature.

## What's genuinely better than React (leave alone)

Worth saying explicitly, because the answer to the headline question is mostly "no" at the core: the read-verb split (`readContext`/`readPromise`/`readData`), signal-based effects with the `undefined`-return trick that makes React-style cleanups a type error, the asset-resource creators (better than React 19 hoistables — plain data, explicit dedupe keys), `lazy` without the `{default}` unwrap, `unsafeHTML` as a plain scary-named string, native `class`/`for`, the `onChange→on("input")` steering warning, the HostConfig (a real cleanup of react-reconciler: 6 required methods, runtime-enforced capability groups, no mode flags, parent-passed instead of context-stack — and no lanes or fibers leak into any public contract), the fig-data key encoder (fixes react-query's silent JSON.stringify traps), the deliberately narrow invalidate/refresh verb set, and the synchronous stream-result object with `shellReady`/`allReady`. The deps arrays on `useMemo`/effects are also the honest choice without a compiler — that's not a habit-ism.

## Sequencing

Done so far: the payload layer in full (the `onError` leak, then the RSC brand renamed away: `@bgub/fig-server/payload`, `renderToPayloadStream`/`createPayloadResponse`/`fetchPayload`/`PayloadBoundary`, `text/x-fig-payload` MIME, `x-fig-payload-boundary` header, `fig-pl-` id prefixes, and structured `{ id, exportName? }` client-reference metadata replacing client-side `#` parsing), the fig-data store-handle mutations (`root.data` + `readDataStore()`, effects run in the ambient store), the error-recovery loop (function `fallback` receives the error; `invalidateData` resets rejected entries), the scheduler in full (Node-liveness fix, dead-surface prune, commit → `requestPaint` wiring, folded into fig-reconciler as an internal module — the published `@bgub/fig-scheduler` package is gone), and the focus/blur decision: the React-style bubbling emulation is deleted — all non-bubbling events attach directly with native semantics, and ancestor focus tracking uses `focusin`/`focusout`. Both Tier-1 items are done: the signal-for-actions contract (supersede/unmount/hide aborts, last-run-wins actions, retired-run inertness — which also surfaced and fixed a latent hook-queue rebase bug) and stage-1 JSX host-prop types (renderer-owned IntrinsicElements augmentation; per-tag bind inference; React-habit props rejected). The prerender feature is done. What remains: the decisions list below.
