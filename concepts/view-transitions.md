# View Transitions

Status: exploring

`ViewTransition` marks DOM surfaces that may participate in native browser
view transitions. It is declarative: it renders no wrapper, and it only does
work when an eligible client commit or a streamed server reveal mutates an
annotated surface.

## Public Surface

`ViewTransition` exports from `@bgub/fig` as a branded callable special
element. Props:

- `name?: string` — explicit `view-transition-name`; absent/`"auto"` uses a
  generated internal name. `"none"` and `""` are reserved and throw a dev
  diagnostic at render time.
- `default?: "auto" | "none" | string`
- `enter?: "auto" | "none" | string`
- `exit?: "auto" | "none" | string`
- `share?: "auto" | "none" | string`
- `update?: "auto" | "none" | string`
- `children?: FigNode`

`"auto"` means browser/default styling; `"none"` disables that phase. String
values become `view-transition-class`.

## Lane Eligibility

A commit may animate only when **every** rendered lane is transition-shaped:
transition lanes, retry lanes (client Suspense reveals), the deferred lane,
and idle. Mirrors React's `includesOnlyViewTransitionEligibleLanes`.

- Retry lanes are eligible on purpose: a client-side fallback→content reveal
  animates exactly like the server-streamed equivalent.
- Hydration lanes are excluded on purpose: hydration changes no pixels, so an
  "enter" for freshly hydrated boundaries would be a visible glitch.
- Only-eligible (not some-lane) semantics keep urgent updates that were
  batched into the commit (expiration, entanglement) from being captured
  mid-animation.

## Client Commit Model

The reconciler treats `ViewTransition` as a structural fiber. Complete-time
sets `ViewTransitionStaticFlag`; static flags are the one class of fiber flag
that **survives commits and bailouts** (mirroring React's `StaticMask`), so
boundaries inside adopted (bailed-out, e.g. memoized-element) subtrees stay
reachable and deleted subtrees are prunable without a full walk.

During eligible commits, commit builds a surface plan from the existing
mutation/deletion flags — no layout measurement, no viewport probing; work is
proportional to affected annotated surfaces. Classification:

- **enter** — mounted with no prior identity (`alternate === null`), unpaired.
  Hydration is excluded: a non-placed boundary whose content carries
  hydration flags adopted pixels that were already on screen (retry-lane
  commits that finish a dehydrated Suspense boundary — e.g. a lazy route
  module resolving after first load — land here) and must not animate. React
  reaches the same outcome by keying enter off Placement flags.
- **update (morph)** — moved boundaries (placed with a prior identity) name
  both the committed and finished instances, so the browser morphs position
  instead of enter-fading. In-place content changes also classify as update.
- **exit** — the outermost boundary of a deleted subtree. Deletion entries
  are walked as single detached subtrees (never their stale siblings).
- **share** — an exiting explicit name matching an appearing explicit name
  becomes a pair. Named boundaries nested inside deleted or newly mounted
  subtrees participate in pairing only (they never enter/exit on their own),
  mirroring React's deleted-pair search.

Nesting: the **innermost** boundary owns an update — an outer boundary only
animates when something changed outside its nested boundaries, and the walk
always descends, so an outer `update="none"` cannot disable an inner
boundary. The **outermost** boundary owns enter/exit. Stably hidden Activity
content is skipped (never captured by the browser); a boundary hiding this
commit still animates its old side away.

Commit sequence: the plan's old surfaces get temporary inline
`viewTransitionName`/`viewTransitionClass` before the old snapshot, the host
runs one view-transition transaction around the existing deletion/mutation/
visibility work, new surfaces are named before the new snapshot, and author
style values are restored once the transition is `ready`.

Dev diagnostics: reserved names (`"none"`, `""`) throw at render; two live
boundaries resolving to one name in a commit (which makes the browser
silently skip the whole transition) warn at plan time.

## Root Snapshot Cancellation

The plan tracks whether the commit mutates layout outside annotated
boundaries (insertions, deletions, moves, or plain mutations not contained in
a collected boundary). When everything is contained, the host cancels the
page-wide snapshot: `view-transition-name: none` on the root element before
the new capture, then at `ready` the captured old root group is hidden with a
filling zero-duration animation and `::view-transition` is zero-sized — so
untouched regions stay interactive while named groups animate (React's
`cancelRootViewTransitionName`). Without measurement this is conservative: a
contained boundary that changes size will shift unannotated siblings without
a cross-fade.

## Serialization

Transitions are serialized per document through a shared mutex property
(`__figViewTransition`, exported as `VIEW_TRANSITION_PENDING_PROPERTY`).
Client commits and inline streaming reveals both check it and chain on the
previous transition's `finished` promise instead of starting a transition
that would abruptly skip the running animation (or race its style restore
against the new capture). Unannotated reveals never park.

Deferred commits (the browser invokes the update callback asynchronously)
freeze the root until the callback runs; errors thrown inside the callback
are routed through the same uncaught-error path as synchronous commits
(report to `onUncaughtError`, clear the root) rather than vanishing into the
transition's promise.

## Server Streaming

Server rendering annotates the nearest host surfaces under a `ViewTransition`
with `data-fig-vt-name` and, when present, `data-fig-vt-class`. Forked render
branches clone the surface-index cursor from the same snapshot, so a Suspense
fallback and its streamed content produce the **same** name sequence and the
reveal pairs (morphs) them; surfaces after the boundary claim later suffixes
via a watermark. Late tasks that suspend mid-branch can still collide in the
deep tail — the browser then skips pairing for the duplicated name rather
than breaking the reveal.

The inline Suspense runtime consumes those annotations for `s`, `c`, and `ac`
reveal operations: it collects old fallback surfaces and staged new surfaces,
performs the existing DOM move inside `document.startViewTransition` (behind
the shared mutex above), applies names to the moved nodes before the new
snapshot, and restores inline styles after the snapshot is ready. If the
browser API is absent, reveals use the existing non-animated path.

## Known Gaps (vs React)

- No layout measurement: any DOM mutation inside a boundary classifies as an
  update even when nothing visually moved, and there is no viewport gating
  (offscreen boundaries still snapshot).
- No transition types, no `onEnter`-style events, no gesture path, no
  pseudo-element refs.
- Reorders morph only the DOM-moved boundary; its swap partner (which did not
  move in DOM terms) does not animate without measurement.
