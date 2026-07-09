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
mutation/deletion flags, then a measurement pass decides who really animates
(React's before/after-mutation measurement, adapted to Fig's single host
transaction). Candidate classification:

- **enter** — mounted with no prior identity (`alternate === null`), unpaired.
  Hydration is excluded: a non-placed boundary whose content carries
  hydration flags adopted pixels that were already on screen (retry-lane
  commits that finish a dehydrated Suspense boundary — e.g. a lazy route
  module resolving after first load — land here) and must not animate. React
  reaches the same outcome by keying enter off Placement flags.
- **update (morph)** — in-place content changes, moved boundaries (placed
  with a prior identity), and boundaries whose **ancestor layout changed**
  around them (a container's own props/child list changed, so descendants
  may have shifted — React's nested-boundary pass). Both sides carry the
  same name so the browser morphs position.
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

Commit sequence and measurement: the prepare pass measures old surfaces
(host view-transition adapter `measure`, `getBoundingClientRect`-based) and
applies temporary inline names before the old snapshot — exits whose old
geometry is outside the viewport are reverted here. The host runs one
view-transition transaction around the existing deletion/mutation/visibility
work. Inside the update callback, after mutations land and before the new
capture, the resolve pass measures new surfaces and decides:

- enters outside the new viewport never receive a name;
- content-driven updates and share pairs always animate; layout-driven
  updates (ancestor-shift and move candidates) animate only when geometry
  actually changed — otherwise the name is taken back off the instance and
  the already-captured old group is hidden at `ready` with a filling
  zero-duration animation (React's `cancelViewTransitionName`);
- a width/height change of a statically positioned surface relayouts its
  parent, and a shrunken surface list relayouts its slot: either keeps the
  root snapshot alive (React's `AffectedParentLayout`).

Author style values are restored once the transition is `ready`. Hosts
without a measurement hook keep every candidate (no cancellation).

Dev diagnostics: reserved names (`"none"`, `""`) throw at render; two live
boundaries resolving to one name in a commit (which makes the browser
silently skip the whole transition) warn at plan time.

## Root Snapshot Cancellation

The plan tracks whether the commit mutates layout outside annotated
boundaries (insertions, pair swaps, deletions, or plain mutations not
contained in a collected boundary), and the resolve pass adds
measurement-driven signals (a parent-affecting resize, a shrunken surface
list). When nothing affected the root, the host cancels the page-wide
snapshot: `view-transition-name: none` on the root element before the new
capture, then at `ready` the captured old root group is hidden with a
filling zero-duration animation and `::view-transition` is zero-sized — so
untouched regions stay interactive while named groups animate (React's
`cancelRootViewTransitionName`). Pure moves (reorders) leave the root
canceled: their companions are themselves flagged and morph on their own.

## Serialization (Suspend Commits, Not Rendering)

Transitions are serialized per document through a shared mutex property
(`__figViewTransition`, exported as `VIEW_TRANSITION_PENDING_PROPERTY`),
shared between client commits and inline streaming reveals. Serialization
over interruption is deliberate: the browser cannot hand an interrupted
transition off to a new one — `skipTransition()` hard-stops and restarts —
and waiting lets rapid updates batch into one clean animation instead of a
stutter of stubs (React's suspend-commits rationale, facebook/react#32002).

Only the **commit** waits, never the rendering. An eligible commit arriving
while a transition is animating **parks** before any commit phase runs (so a
superseded parked commit never runs effects) and the reconciler keeps
scheduling: newer renders replace the parked tree — its lanes were never
marked finished, so a fresh render absorbs them — and the **latest** state
commits the moment the running animation's `finished` resolves. Rapid
interactions therefore advance at one latest-state animation per
animation-window rather than queueing one animation per interaction.
Non-eligible (sync/default-lane) commits never park; urgent updates land
under the animation, matching React. Unannotated streaming reveals never
park either.

Deferred commits (the browser invokes the update callback asynchronously)
freeze the root until the callback runs — that capture window is sub-frame,
unlike the animation-length park. Errors thrown inside the callback are
routed through the same uncaught-error path as synchronous commits (report
to `onUncaughtError`, clear the root) rather than vanishing into the
transition's promise. Hosts wired without the view-transition adapter's
`suspend` hook fall back to fig-dom's chained wait, which freezes the root for
the previous animation's full duration.

Exploring: whether parked-commit latency under rapid input warrants
API-free mitigation (fast-forward via `playbackRate`, a park-timeout
backstop, stale-surface auto-interrupt) — see open-questions.md.

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

- No transition types, no `onEnter`-style events, no gesture path, no
  pseudo-element refs.
- Ancestor-layout candidates come from a parent's _own_ flags: a sibling
  insertion shifts later siblings without flagging their shared parent, so
  boundaries shifted only by an inserted sibling are not collected
  (placement flags live on the inserted fiber). React's measurement-only
  nested pass has the same reach through updated parents.
- Content-driven updates always animate, without React's keyframe
  optimization that strips width/height animation from unchanged-size
  groups at `ready`.
