# Restructuring Ideas — July 2026

Status: **brainstorm / investigation**. Nothing here is committed work. This doc
consolidates architectural ideas for fig / fig-dom / fig-reconciler gathered
from two brainstorm sessions (Claude, Codex) in July 2026, aimed at some mix
of: performance, code simplification, observability, and bundle size.

Companion: `tmp-reconciler-optimization-notes.md` (repo root) holds the
_incremental_ optimization notes and the three experiments already run
(prepared update payloads — reverted; dev-only refresh matching — kept). This
doc is the structural layer above those.

Grounding facts the ideas lean on:

- The reconciler is a single ~7.1k-LOC closure per renderer instance
  (`packages/fig-reconciler/src/index.ts`) — fiber shape is fully private; no
  public API observes it except dev-only devtools snapshots.
- Commit runs several separate walkers (mutations, deletions, data
  dependencies, external stores, hydration retries, effects) gated by per-root
  `needs*` booleans, rather than React's linked effect list.
- Fig owns its compiler plugin (`fig-vite`), its JSX runtime, and its wire
  format (payload) — assumptions React can never make.
- Reads are explicit verbs (`readContext`, `readData`, `readPromise`), effects
  take AbortSignals and never return cleanups, and there is no `useRef`.
- Known perf gaps (`concepts/open-questions.md`): initial mount and same-order
  updates trail React; reverse-keyed reorders now beat it.

---

## Theme A — Data-structure bets

### A1. Fiber arena

Replace object-per-fiber churn with arena-backed fibers. Two variants on a
spectrum:

**Variant 1 — generation-reset arena (moderate).** Each root owns two or three
arenas (current, work-in-progress, scratch) with a bump cursor:

```ts
interface FiberArena {
  fibers: Fiber[];
  cursor: number;
  reset(): void; // O(1) abort of a render generation
  alloc(tag, type, key, props): F;
}
```

A completed render swaps arenas; an aborted render resets the WIP arena in
O(1). Fibers may store integer indexes for `return`/`child`/`sibling` links
instead of object references. Upside: cheaper aborted renders, less GC, better
locality, bulk cleanup of render-only fields, and commit work-lists become
integer ranges.

**Variant 2 — struct-of-arrays arena (aggressive).** Parallel typed arrays:
`tags`, `flags`, `subtreeFlags`, `lanes`, `childLanes` as `Int32Array`s;
tree links and `alternate` as integer indices (alternate can be index pairing,
making double-buffering allocation-free). Only props/hooks/state stay in a
side `Array<object>`. The walk-heavy begin/complete/commit passes become scans
over contiguous memory.

Sleeper benefit of variant 2: the whole tree state becomes a copyable buffer.
Devtools snapshots become `slice()` instead of walking and allocating, and a
commit's-worth of tree state can be `postMessage`-transferred to an
out-of-page panel essentially for free.

Risks: the biggest rewrite in this doc; JS engines are already good at
monomorphic objects, so this must prove itself in `benchmarks/reconciler.mjs`
before expanding; TypeScript ergonomics degrade unless wrapped carefully;
debugging gets harder. Staging: prototype on the flags/lanes/links subset
first (keep props as objects) — that's where the walk-heavy passes live.

### A2. Shape-specialized reconciliation

Most renders return the same structural child shape repeatedly: single child,
fixed tuple, keyed row list, text-only host. Today `reconcile()` /
`collectChildren()` rediscover the shape every time via normalization, key
checks, type checks, map construction, placement logic.

After a subtree proves stable for a few renders, cache a plan on the fiber:

```ts
type ChildShapePlan =
  | { kind: "single"; tag: Tag; key: Key | null }
  | { kind: "fixed"; slots: ChildSlotPlan[] }
  | { kind: "keyed-list"; keyToIndexHint: Map<string, number> };
```

Reconciliation tries the cached plan first; on match it runs a straight-line
update path; on mismatch it invalidates and falls back to generic
reconciliation. This is a runtime specialization system — more ambitious than
a "fast path for scalar children," but failure is cheap because the generic
path remains the fallback.

Upside: fewer allocations, fewer key/type branches, no per-render map
construction on stable shapes, better hot-path locality — aimed squarely at
the same-order-update gap. Risk: invalidation correctness (the plan must be
discarded on any shape divergence, including key changes and conditional
branches flipping).

---

## Theme B — Commit restructure

### B1. Commit-as-data: from CommitPlan to commit tape

One family, three points on an aggressiveness spectrum. All share the core
move: **render/complete identifies work once; commit applies it directly**,
instead of `commitRoot()` rediscovering work through repeated tree walks
gated by `needs*` booleans.

**Point 1 — CommitPlan with category arrays (conservative).** During
complete, build an explicit plan for the finished tree:

```ts
interface CommitPlan<Container, Instance, TextInstance> {
  mutations: F[];
  placements: F[];
  deletions: F[];
  hostUpdates: F[];
  effects: F[];
  dataDependencies: F[];
  externalStores: F[];
  dehydratedBoundaries: F[];
}
```

`commitRoot()` consumes the plan. This consolidates several notes from the
tmp doc in one design: commit walker consolidation, fewer stack allocations,
fewer `rootOf()` walks, less repeated hoisted classification, a simpler
common path.

**Point 2 — intrusive lists.** Avoid the arrays: category-specific
`nextCommit` pointers on fibers form intrusive linked lists, so plan
construction allocates nothing.

**Point 3 — commit tape (aggressive).** Complete emits a flat instruction
buffer — opcode + operands (`INSERT parent idx node`, `SET_TEXT node str`,
`PATCH node propsRef`, `EFFECT fiber phase`) — and commit is a single linear
interpretation of the tape. Beyond perf, the tape is a _trace format_:

- devtools gets exact per-commit diffs without instrumenting anything;
- reconciler tests can assert on tapes with no DOM at all (sharper than
  happy-dom for reconciler-level suites);
- a small ring buffer of recent tapes is a production flight recorder,
  attachable to error reports;
- a tape is serializable, opening the door to rendering in a worker with the
  main thread only interpreting tapes — the client-side sibling of the
  payload wire format.

**Radical variant:** make `flags`/`subtreeFlags` a render-time summary only
(kept for parent bubbling and view-transition gating), with actual commit
work discovered exclusively through the explicit queues/tape — flags stop
being the commit discovery mechanism entirely.

Staged plan (from the Codex session, applies to the whole family):

1. Extract the plan type; build it conservatively from the existing finished
   tree with minimal behavior change.
2. Switch one low-risk category first (host updates or data-dependency
   commits).
3. Add counters/tests asserting the old walker and the new plan see the same
   fibers.
4. Expand category by category only while benchmarks stay flat or improve.
5. Once several categories are plan-backed, simplify `commitRoot()` and
   delete the redundant walks.

Real risks: hydration, view transitions, Suspense reveal, and deletion
ordering are stateful/interleaved today — do not attempt as one rewrite. The
tape variant additionally must not allocate more than the walks it replaces
(preallocated buffers / object pool; composes with A1 where operands become
arena indices).

**Status (2026-07-08): stage 1 SHIPPED.** A unified per-root commit queue
(fibers pushed during render from `prepareHookRender`, `appendDeletion`, and
error-boundary capture; boundary watermarks truncate discarded subtrees;
each pass re-checks its own per-fiber predicate) replaced the deletion,
data-dependency, external-store, live-hook, and caught-error discovery
walks, deleted `DataDependencyFlag` outright, and runs the old walks as
dev-only parity assertions (stripped from prod). Results:
`commit.sparse-leaf-state-update` −37% (1k rows), sparse context −12%,
suspense sibling reveal −6%, everything else flat-or-better; +68 B minified.
Contract documented in `concepts/rendering.md` (Commit And Batching).

**Stage 2 (same day): effects + deleted-view-transition collection.**
Effect execution is not idempotent, so the queue gained a uniqueness
invariant: `CommitQueuedFlag` (reusing the retired `DataDependencyFlag`
bit) dedupes pushes, is masked out of `subtreeFlags` aggregation, and is
cleared on drain/truncation so the flag-clearing walk never has to reach
it. `visitEffects` became a dev-only parity counter; commit-time arming of
revealed boundaries' deferred effects queues owners directly.
Hydration-retry collection stays walk-based: it needs boundaries in the
committed tree that the render never touched (a registry redesign, not a
queue fit). The new `rows.remove-10pct` benchmark also exposed a
pre-existing gap: Fig performs optimal host ops on head removal but is ~50%
slower than React in reconcile CPU time — a `plans/
reconciler-placement-performance.md` candidate, unrelated to the queue.

**Stage 3 (same day): host updates + view-transition attribution.**
`UpdateFlag`/`TextContentFlag` no longer enter `subtreeFlags`; steady-state
host updates commit from the queue before the mutation walk, which now
prunes update-only regions (as does the flag-clearing walk). View
transitions recover the lost subtree signal via
`attributeQueuedHostUpdates`: each pending update attributes to its
innermost enclosing VT boundary, to the root snapshot when nothing encloses
it, or to nothing when a portal intervenes — replacing both
`subtreeFlags & MutationMask` reads. Ownership lessons the parity asserts
and tests taught: hydration commits are position-sensitive (an Activity
template must unpack before its hydrated children bind) and stay in the
walk; first commits belong to placement/assembly (an early `commitUpdate`
sets `committedProps` and silently defeats `acquireHoistedInstance` — the
head-stylesheet test class); hydrated text is the exception (its first
"update" is how the differing value applies). Placements and visibility
remain walk-driven — the residual walk is now placement-shaped, which is
the right substrate for a future tape with explicit ordering. Cumulative
cost of all three stages: +342 B minified; benchmarks flat-to-improved
throughout.

**Follow-up (2026-07-09): the remove-10pct gap was a real bug, now fixed.**
Profiling showed ~40% of the scenario's CPU inside walk machinery, and the
attribution led to deletion teardown: `abortFiberEffects` walks root
siblings (correct for its hiding-boundary caller), but keyed-map deletion
entries are old-generation fibers whose sibling pointers still reference
kept fibers with hook state shared with the live tree — so deleting N
head rows aborted effects/stores/stable-events on every kept row,
O(deleted × remaining), silently correct-looking in hook-free benchmarks.
Fixed by fusing deletion teardown (data release + hook aborts) into one
walk bounded to each deleted subtree, with a regression test. Result:
remove-10pct(1k) 2.9ms → ~0.9ms, from ~50% behind React to ~45% ahead. The
"placement performance" investigation this benchmark seemed to motivate is
closed — the gap was teardown, not placement.

**Negative result: the tmp-notes "pointer walk" idea is invalid.**
Rewriting `walkFiberTree` to backtrack over `return` links (no per-walk
stack) deterministically broke the demo-ssr
failed-Suspense-inside-hidden-Activity e2e: tier-1 bailouts adopt
current-generation children whose `.return` still points at the other
generation's parent, so walks that descend through an adopted seam (e.g.
`collectDehydratedSuspense`, which prunes nothing) escape into the previous
fiber generation on backtrack. The stack walk never dereferences `.return`
and is immune. This also cuts against the A1 arena's "integer links +
return-based traversal" variant — any traversal design must treat adopted
seams as generation boundaries. With teardown fixed, walk overhead is not
a measurable cost anyway (the profile's walk-heavy readings were the
O(deleted × remaining) bug, not walk machinery).

---

## Theme C — Reconciliation strategy shifts

### C1. Compiler-extracted templates as a first-class fiber tag

The Solid/Svelte move inside a fiber architecture, available because Fig owns
`fig-vite` and its JSX runtime: the compiler splits static JSX into a hoisted
template (`<template>` clone per instance) plus a dynamic-slot list. A new
`TemplateTag` fiber skips per-element begin/complete entirely — mount is
`cloneNode(true)` + slot binding; update diffs only the slot array. Most of
the tree stops being fibers at all, which changes the game on the
initial-mount gap rather than narrowing it.

Server composition: the payload format can carry template IDs instead of full
element trees — smaller wire size, and hydration of static regions becomes
"adopt the DOM range, bind slots." Fallback: components the compiler can't
analyze (dynamic tags, spreads) render as today, so adoption is incremental
per-element.

Risks: a second reconciliation model beside the first; events/bind/hydration
markers all need slot-aware paths. The central design question is the slot
identity contract — Fig has prior art in positional `events={[on(...)]}`
identity.

**Status (2026-07-09): runtime spike SHIPPED, verdict — EARNS THE PROJECT.**
An experimental `TemplateTag` fiber (element type = object marked
`Symbol.for("fig.template")`; host hooks `createTemplateInstance` /
`commitTemplateUpdate`; slot updates ride the commit queue; ~180 B) plus a
hand-authored descriptor standing in for compiler output, measured on the
in-memory bench host against the identical fiber-rendered row shape:
initial mount **2.2–2.8×**, same-order slot updates **3.0–4.2×**,
reverse-keyed reorders **2.2–2.3×** — inside the 2–5× kill-criterion band,
and this counts only reconciler-side savings (native `cloneNode` should
widen it in real DOM). Spike scope cuts: single-root templates, text
slots, CSR only, in-memory host. The full project's open fronts, in order
of risk: event handling inside templates (fig-dom dispatch walks the
fiber tree; template interiors have no fibers — needs slot-registered
handlers or delegation metadata), hydration/SSR (payload carries template
IDs; server renders template HTML; client adopts DOM ranges), the actual
`fig-vite` transform (mechanical), and fig-dom host hooks
(`<template>`-backed clones).

**Status (2026-07-09, later): ALL FOUR FRONTS SHIPPED — feasibility
CONFIRMED.** (1) Events: fig-dom dispatch turned out to be per-DOM-element
(`eventSlots` keyed by element, `eventPath` walks DOM ancestry), so
template interiors reuse `updateEvents` verbatim — positional slot
identity, abort-on-change, delegation, and attach/detach-on-insertion all
work unchanged; delegated clicks bubble from template interiors into
fiber-level handlers with zero dispatch changes. (2) SSR + hydration: the
descriptor moved to `@bgub/fig` (`template(html, slots, segments?)`) with
`segments` as the server projection — static strings interleaved with
slot indexes, escaped by slot kind, event slots skipped; fig-server
renders them in `renderTemplateElement`; hydration adopts the server
element (`tryHydrateTemplate` consumes one hydratable, never descends;
`commitHydratedTemplateInstance` resolves slot paths and binds event
slots only). (3) fig-dom host hooks: real `<template>`-prototype clones
with path-resolved slot nodes; attr slots route through single-prop
`updateElement` for full policy correctness. (4) Compiler: `figTemplates()`
Babel plugin in fig-vite compiles eligible JSX to hoisted descriptors
(html + slots + segments), forwards root keys, and compiles eligible
subtrees nested inside ineligible parents (e.g. rows inside a `.map`).
v0 eligibility bails on: components/fragments/spreads/bind/unsafeHTML
anywhere, dynamic text sharing an element with siblings (adjacent text
nodes merge when HTML parses — paths would shift), non-root keys,
single-element trees. Cost: ~630 B fig-dom, ~180 B reconciler, ~90 B fig.
Remaining before productizing: payload/server-component transport for
descriptors (template IDs + a module registry — same shape as client
references), a real-browser benchmark, `bind` inside templates, dev
mismatch diagnostics for hydrated templates, and a concepts/ file
graduating the descriptor contract.

### C2. Direct-to-host data binding (signals as an optimization, not a model)

Preact Signals' bypass trick without adopting its programming model: when a
store-backed value (`readData`, `useSyncExternalStore`) flows _unmodified_
into a text child or a single host attribute, commit installs a direct
subscription — store change → patch that one host instance — skipping
scheduling, render, and diff. Structural changes still schedule a lane as
today; the fast path exists only where the dependency is provably
slot-shaped. Feasible because data flow already runs through a centralized
store (`fig/src/data-store.ts`).

Million's contribution is the list version: a `For`-style primitive over a
keyed data resource diffs the **data array**, not the fiber tree —
O(changed items) with per-item edit maps. Attacks the large-keyed-list
territory from the opposite side of the placement work (skip the fibers
rather than reorder them faster).

Composes with C1: templates define the slots; direct subscriptions fill them
— together they are essentially Solid's runtime inside a fiber architecture
that still handles suspense/transitions/hydration the fiber way.

Risks: two update paths means two consistency stories. The direct path must
respect batching, transitions (a parked view-transition commit must not be
visually contradicted by a direct patch), and hydration adoption. Guard:
keep eligibility brutally narrow; everything else falls through to the
normal loop. Precondition: measure whether hot updates in real Fig apps
actually originate in the store — if not, this is leverage on the wrong
lever.

---

## Theme D — Modularity and bundle

### D1. Feature-modular reconciler (tree-shakeable capabilities)

The 15.75 kB reconciler ships hydration, streaming suspense, activity, view
transitions, and portals to every consumer because begin/complete/commit
switch over all 12 tags inline. Restructure around per-tag/per-feature
handler tables that capabilities register into:

```ts
createRenderer(hostConfig, [suspense, hydration, viewTransitions]);
```

Each capability contributes its begin/complete/commit/throw handlers _and its
slice of root state_ — which is exactly the shape of `dehydratedBoundaries`,
`pendingViewTransitionCommit`, `suspendedThenables`; the FiberRoot is already
a junk drawer of feature-specific fields. A CSR-only app drops hydration and
view transitions from the bundle. `fig-dom` offers `createRoot` presets so
users never see the plumbing.

This is also the answer to the 7.1k-LOC file: the split falls along feature
seams (matching how `concepts/` is organized one-file-per-subsystem), each
capability's invariants live next to its code, and registration points are
natural tracing hooks. Preact's `options` object is prior art that a tiny
core + interception points is enough to build devtools, debug, and even
signals integrations as external packages.

Risk: dispatch-table indirection on the hot path where an inlined switch is
free. Mitigation: keep the four hot tags (host/text/function/fragment)
inlined; dispatch only for capability tags — which is also honest about
what's hot.

---

## Theme E — Async, types, and the server boundary

### E1. Structured concurrency: a supervised scope tree for everything async

Fig's AbortSignal-everywhere contract is structured concurrency's calling
convention without its runtime. Today the async bookkeeping is scattered:
`suspendedThenables` WeakMap, module-level ambient `asyncTransitionLanes`
counts, retry-lane pinging, per-effect signal plumbing. Replace with one
scope tree mirroring the fiber tree: every transition, data load, action, and
effect registers in the scope of the fiber that started it;
unmount/re-suspend/interrupt disposes the scope and all descendant signals
abort automatically — signal derivation exists once instead of per-feature.

Effect's lesson: supervision _is_ observability. Each scope is a span with a
cause chain — "why is this Suspense boundary still pending?" becomes a
devtools query answered with the exact pending resources and their origins,
rather than reverse-engineering lane state. The view-transition-parking
responsiveness question and the (fixed) offscreen-hang bug class are both
"orphaned async work" failures a supervised tree makes structurally
impossible, or at least inspectable.

This does **not** mean taking an Effect dependency (fig-start deliberately
keeps Effect behind a boundary) — it's the discipline, ~200 lines of scope
tree, not the library. Risk: must cost nothing when nothing is async (lazy
scope creation; a sync-only commit never allocates one).

### E2. Typed requirement and error channels

verrex's insight (Effect-native UI: `Effect<View, E, R>` channels propagate
from every leaf to the root, so a forgotten service layer is a compile-time
error naming the missing dependency) applies to Fig because reads are already
explicit verbs — statically visible in a way React's implicit context and
`use()`-anything never were.

Propagate them as channels: `Component<Props, Requires, Throws>`; the JSX
runtime unions children's `Requires` upward; `<Ctx.Provider>` subtracts from
the union; `ErrorBoundary` subtracts from `Throws`; `createRoot` /
`renderToStream` accept only trees whose remaining requirement set is empty.
Forgetting a provider or leaving a data resource unhandled fails at the root,
naming the missing thing.

Two implementation tiers:

- **Type-level (research-grade):** verrex needed a custom `.vx` extension
  because TSX collapses to `JSX.Element`. Fig owns `jsx-runtime.ts` and can
  push generic element types further, but TS inference may buckle at depth.
- **Build-time analysis (pragmatic 80%):** the `figData` transform in
  `fig-vite` already parses component sources; a build pass computes the real
  requirement graph and fails the build instead of the typecheck.

Either tier yields an artifact nothing else in this doc provides: a **static
dependency graph per route** — the server can start every data load for a
subtree before rendering it; devtools can show "this boundary is pending on
these two resources" with zero runtime bookkeeping.

### E3. Resumable hydration: serialize fiber state into the payload

Selective hydration, dehydrated boundaries, and early-event capture already
exist; the remaining cost is that hydration re-executes every component to
rebuild hooks and fibers. The Qwik-shaped bet, available because Fig owns the
payload format: the server serializes enough per-boundary state (hook
`memoizedState` for serializable hooks, context snapshot, child structure —
much of which the payload already encodes) that the client **builds fibers
without calling components**, adopts the DOM, and executes a component only
the first time it actually re-renders. Combined with the replayable-event
queue, time-to-interactive stops scaling with tree size.

Fig-specific tractability that React lacked: no `useRef` (the classic
unserializable hook); effects are AbortSignal-based with explicit phases
(clean "run effects on resume" contract); `readData`/`readContext` are
explicit verbs the serializer can see. Honest scope cut: closures in
props/state don't serialize, so this works only below boundaries whose
inputs come from the payload — which is exactly the server-components
region, so the boundary already exists in the architecture.

---

## Composition map

- **A1 + B1**: tape/plan operands become arena indices; work-lists become
  integer ranges. The two data-structure bets reinforce each other.
- **A2 + B1**: a matched shape plan can emit its commit instructions
  straight-line, skipping generic complete-phase discovery.
- **C1 + C2**: templates define slots; direct subscriptions fill them —
  jointly ≈ Solid's runtime inside a fiber architecture.
- **C1 + E3**: templates make resumable regions cheap to describe on the
  wire (template ID + slot values instead of element trees).
- **E1 + E3**: resumability needs an explicit inventory of pending async
  work per boundary; the scope tree is that inventory.
- **D1** is a precondition-softener for everything: once capabilities are
  modular, big bets (B1 point 3, C1) can ship as opt-in capabilities before
  becoming defaults.
- Long-term, the ideas cluster into two directions that partially compete
  for the same rewrite budget: **(A1+B1)** "make the fiber machine itself
  cheap and observable" vs **(C1+C2+E3)** "make most of the tree stop being
  fibers." Both are viable; doing both at full aggression is two rewrites.

## Suggested sequencing

1. **B1 points 1–2 (CommitPlan)** — highest leverage-to-risk ratio; direct
   continuation of validated work in the tmp notes; staged plan exists;
   simplifies the messiest part of the monolith. Decide on tape (point 3)
   only after categories are plan-backed.
2. **A2 (shape specialization)** — optimistic fast path with clean fallback;
   cheap to fail; targets a known benchmark gap (same-order updates).
3. **E1 (scope tree)** — low-regret refactor of existing bookkeeping;
   observability payoff; unblocks E3 later.
4. **D1 (feature modularity)** — most certain bundle win; makes the codebase
   match its own spec structure; softens later big bets.
5. **A1 / C1** — the big perf swings; benchmark-first spikes before any
   commitment (A1 on the flags/lanes/links subset; C1 behind a compiler flag
   on a demo app).
6. **C2** — only after measuring where hot updates originate in real apps.
7. **E2 build-time tier** — differentiating feature work, independent of the
   reconciler bets.
8. **E3** — the moonshot; revisit once E1 and the payload codec work
   (`concepts/open-questions.md`) have landed.
