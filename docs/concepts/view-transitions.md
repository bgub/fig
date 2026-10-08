# View Transitions

Status: exploring

`ViewTransition` marks DOM surfaces that may animate during a native browser view transition. It adds no wrapper element and does nothing unless an eligible client commit or server reveal changes that surface.

## Public API

`ViewTransition` is a branded component exported by `@bgub/fig`:

```tsx
import { ViewTransition } from "@bgub/fig";
import {
  enableViewTransitions,
  getViewTransitionPseudoElements,
} from "@bgub/fig-dom/view-transitions";

enableViewTransitions();

<ViewTransition name="article" enter="slide-in" exit="slide-out">
  <Article />
</ViewTransition>;
```

`enableViewTransitions()` activates native DOM View Transitions for the current application. It is permanent and idempotent, may run after roots exist, and may live in the module that first renders a transition surface, including a lazy route. Importing the module alone does not activate the feature. The ordinary `@bgub/fig-dom` entry includes neither the document View Transition planner nor its commit coordinator.

In development, rendering a `ViewTransition` before installing a coordinator that declares `viewTransitions: true` reports a one-time renderer-neutral diagnostic; its Fig DOM guidance points to `enableViewTransitions()`. Production continues to degrade to ordinary rendering when that support is absent.

`ViewTransition` itself stays in core because it is a renderer-neutral boundary. `@bgub/fig-reconciler/view-transitions` owns the optional planning and commit-coordination module; `@bgub/fig-dom/view-transitions` combines that planner with the browser host and explicitly installs the resulting coordinator on Fig DOM's existing renderer.

Its props are:

- `name?: string` — an explicit `view-transition-name`; missing or `"auto"` uses a generated name.
- `default`, `enter`, `exit`, `share`, and `update` — each accepts `"auto"`, `"none"`, or a class string.
- `onTransition?: (event, signal) => undefined` — runs when the native pseudo tree is ready and remains live until `signal` aborts.
- `children?: FigNode`.

`"auto"` keeps browser/default styling. `"none"` disables that phase. Empty names and `name="none"` are reserved and throw in development.

## Transition Options

Both transition entry points accept native animation types and an optional interruption policy as trailing options:

```ts
transition(() => navigate("/inbox"), {
  types: ["navigation", "forward"],
  viewTransition: "interrupt",
});

const [isPending, start] = useTransition();
start((signal) => refresh(signal), { types: ["refresh"] });
```

Fig records types when an update reaches a root, rather than reading mutable global state at commit time. Nested scopes on the same lane union their types in insertion order, duplicate values collapse, and a commit unions the types of all rendered lanes. Types therefore follow the updates they label across async callbacks and concurrent roots without leaking into unrelated retries, deferred reveals, or later commits. After `await`, call the transition’s explicit `update` to retain that ownership. Scope options release on callback settlement or cancellation; options already recorded on scheduled root work remain attached to that work.

When the resulting list is non-empty, Fig DOM calls `document.startViewTransition({ update, types })`. It keeps the callback-only browser form for an untyped transition.

`viewTransition: "interrupt"` makes newest user intent replace an active native animation. Interruption is sticky within a transition lane and wins when a commit includes multiple rendered lanes. Fig calls `skipTransition()` on the active browser transition, waits for its `finished` promise so restoration completes, then commits the latest rendered state and starts a new transition when the commit has participating boundaries. Without this option, eligible commits retain the default serialized behavior.

Fig DOM drops the implicit full-page `root` snapshot for interruptible commits, even when changed layout outside an explicit boundary would normally retain it. Controls outside explicit transition surfaces therefore remain live pointer targets that can express the next intent. Browsers deliberately remove captured elements and their descendants from hit testing, so an interactive control that must interrupt an animation cannot sit inside an authored `ViewTransition` or `view-transition-name` surface.

## Lifecycle And Pseudo Elements

`onTransition` receives one renderer-neutral event for a participating boundary:

```tsx
<ViewTransition
  name="article"
  onTransition={(event, signal) => {
    for (const surface of event.surfaces) {
      const pseudos = getViewTransitionPseudoElements(surface);
      pseudos.new?.animate({ opacity: [0, 1] }, { duration: 180 });
    }

    signal.addEventListener("abort", () => stopExternalWork());
  }}
>
  <Article />
</ViewTransition>
```

The event has:

- `phase: "enter" | "exit" | "share" | "update"`;
- `types`, the deduplicated types attached to this commit; and
- `surfaces`, one opaque `{ name }` handle for each top-level host surface owned by the boundary.

The callback runs after native `ready`, once the pseudo tree exists. It does not run if the browser rejects or skips readiness, or if measurement removes every surface for that boundary. The incoming boundary owns a shared pair's callback; the committed outgoing boundary owns an exit. The signal aborts at native `finished`. Callbacks return nothing, and surfaces are event-scoped handles rather than persistent refs.

For Fig DOM surfaces, `getViewTransitionPseudoElements(surface)` returns `group`, `imagePair`, and nullable `old` and `new` handles. Each handle exposes its selector plus `animate`, `getAnimations`, and `getComputedStyle`. The resolver rejects fabricated surfaces and keeps DOM types out of `@bgub/fig`. Animations started through a pseudo handle are owned by the transition and canceled when its signal aborts, including filled animations that could otherwise affect a later transition reusing the same name. Resolving an expired surface or calling `animate`, `getAnimations`, or `getComputedStyle` on an expired pseudo handle throws before accessing the DOM. Cancellation tracks the returned animation objects directly; it does not enumerate document animations.

## Which Commits May Animate

A commit can animate only when every rendered lane is transition-shaped: transition, Suspense retry, deferred, or idle work.

In practice, navigation wrapped in `transition()` may animate, while a direct state update from typing should commit immediately without waiting for or starting a page transition.

Retry lanes are eligible so a client Suspense reveal matches a streamed server reveal. Hydration is not eligible because attaching fibers should not change pixels. If urgent work is batched into the same commit, the whole commit skips animation rather than capturing input-driven changes mid-transition.

## Building A Transition Plan

During an eligible commit, the reconciler finds changed surfaces and classifies them:

- **Enter:** the outermost transition boundary in a newly placed subtree.
- **Exit:** the outermost transition boundary in a deleted subtree.
- **Update:** the innermost boundary whose content or surrounding layout changed.
- **Share:** an exiting explicit name paired with an entering boundary of the same name.

A fiber with no alternate is not automatically new. Fig may reuse a committed fiber in place through bailouts, so placement flags are the reliable enter signal. Hydrated content is also not an enter because its pixels were already visible.

Moved keyed boundaries count as updates. A sibling reorder marks the level as layout-changing so nearby transition surfaces can be measured too.

The innermost boundary owns an update, allowing an inner animation even when an outer boundary has `update="none"`. The outermost boundary owns enter and exit. Hidden Activity content is skipped; content that hides in this commit may animate its old side away.

Two live boundaries resolving to the same unpaired name cause a development warning because the browser would silently skip that transition group.

## Measurement And Commit

Before mutation, Fig measures old surfaces and temporarily applies transition names. Exits already outside the viewport are removed from the plan.

The host then runs the normal mutation work inside one `document.startViewTransition` callback. Before the browser captures the new state, Fig measures again:

- enters outside the viewport lose their name;
- content changes and shared pairs animate;
- layout-only candidates animate only when their geometry changed; and
- a resize that affects parent layout keeps the root snapshot active.

If a layout candidate did not move, Fig removes its live name and hides the already-captured old pseudo-group with a zero-duration animation. Author styles are restored when the transition becomes ready. Hosts without measurement support keep every candidate.

During a streamed reveal, hydration may attach while the browser is capturing annotated surfaces. Hydration diagnostics ignore inline `view-transition-name` and `view-transition-class` declarations that match the element's `data-fig-vt-*` annotations; when every inline declaration matches, the `style` attribute itself is also omitted from the diagnostic. Unrelated server-only styles on the same element are still reported.

## Root Snapshot

The browser captures the whole page by default. Fig cancels that root snapshot when all layout changes are already covered by named surfaces. Untouched regions then remain live and interactive while those groups animate.

Changes outside a transition boundary, parent-affecting size changes, or shortened surface lists keep the root snapshot for ordinary transitions. Pure keyed moves may still cancel it because the moved surfaces animate on their own. Interruptible commits always cancel the root snapshot so live controls outside explicit surfaces remain pointer-interactive; uncovered layout changes update immediately instead of animating as part of the root.

Root-name restoration and temporary hide animations remain in place until `finished`, not merely `ready`. Restoring the root name during an active animation can reconnect the live page to a hidden captured group and briefly paint the page blank.

## One Transition At A Time

Client commits and annotated server reveals share a per-document `__figViewTransition` mutex. A client-owned entry exposes a logical `finished` promise that settles after normal animation completion or capture cancellation, and forwards native `skipTransition()` when available. Both client and server waiters therefore wake on cancellation without depending on the abandoned native promise. By default, a new eligible commit waits for the current animation to finish instead of calling `skipTransition()` and producing a stutter. A client transition carrying `viewTransition: "interrupt"` explicitly chooses responsiveness over completing the active animation: Fig skips it, waits only for settlement cleanup, and then resumes the latest commit. Completion cancels snapshot-hiding animations, restores the root snapshot name, and finishes lifecycle callbacks before releasing the client-owned lock. Lock release still runs if a lifecycle callback throws; reentrant or late completion cannot repeat cleanup.

Only commit waits. Rendering continues normally:

1. An eligible tree finishes while another transition is active.
2. Fig parks it before any commit phase or effect runs.
3. Fig tries adding newer transition work to that parked tree one dependency group at a time. Separate ready queues coalesce into the next animation. If an added group suspends, previously ready independent lanes remain eligible and other ready groups can still join them. Transitions updating the same state queue remain entangled, so their readiness cannot be separated; a later selection supersedes the earlier parked selection.
4. When the animation finishes, the latest state commits and starts the next transition.

Sync and default-lane commits never park behind an already-running animation; work arriving during capture preparation follows the capture rules below. Unannotated server reveals do not park either. A 60-second safeguard releases a commit or reveal if the prior browser transition never settles.

From preparation until browser readiness restores surface styles, the capture owns the root, including when the browser runs mutation synchronously but defers readiness. Hook implementations and before-layout effects publish inside the actual mutation transaction, so callbacks invoked during the deferred interval still observe the committed tree. If store snapshots changed before mutation, Fig abandons the stale capture, cancels its planned surfaces and root snapshot, restores the previously committed author styles, suppresses its transition callbacks, and retries the render after releasing the capture. Restoration uses the new surface props only after successful mutation; a stale capture cannot publish speculative `view-transition-name` or `view-transition-class` styles. The capture retains its exact commit candidate: mutation returns an explicit committed, stale, or failed outcome, and capture release cannot complete a newer candidate. Errors thrown there follow the normal root uncaught-error path. Hosts without the reconciler's suspension hook fall back to the same chained wait in Fig DOM.

Stale or failed candidates cancel the entire native animation and release the document lock immediately, without waiting for browser readiness or the discarded animation's completion. Transition-priority retries therefore cannot park behind their own abandoned capture. Author styles are restored and late callbacks remain inert even when native cancellation is unavailable or throws.

Explicit `flushSync` and `unmount` interrupt that capture instead of waiting for browser readiness. Fig skips the native animation, validates and finishes an unmutated candidate (or discards it if stale), restores author styles, and releases capture before applying the urgent update. `unmount` uses the same path so cleanup finishes before the root's data store is disposed. Mutation that already started finishes coherently; it is never replayed. Interrupted captures suppress transition callbacks, and late browser update, ready, and finished callbacks cannot mutate the tree or restore styles over a newer capture. Native `skipTransition()` failure does not block synchronous completion. Automatically scheduled synchronous work, including before-paint repairs, discrete updates, and external-store notifications, retains its priority but waits for readiness without skipping the animation. Before-paint effects themselves run inside the mutation transaction; their follow-up state updates publish after capture release and may therefore be absent from the captured snapshot. Automatic post-commit flushing cannot interrupt another root's capture. Once readiness releases capture, the ordinary animation serialization policy above applies.

### Before-paint repairs and captured pixels

Browser readiness means the new snapshot has already been captured. A state update queued by `useBeforePaint` can therefore repair the live DOM without repairing the pixels shown by the animation. For example, a newly opened panel may first render at an estimated height and measure its actual height in `useBeforePaint`. If that measurement sets state, the snapshot can retain the estimated height for the animation's duration, then jump to the corrected live layout when the animation ends.

Prefer deriving snapshot-critical layout from render state or CSS. If measurement is necessary, measure before starting the transition when the relevant geometry is available. A direct DOM adjustment made inside the before-paint callback participates in the mutation transaction, but a follow-up state render waits for readiness. When the final layout cannot be prepared in advance and displaying the intermediate snapshot would be misleading, use an ordinary update for that interaction. `flushSync` outside commit can force pending work to complete by canceling capture; it does not repair an already-captured snapshot while preserving its animation.

## Server Streaming

Server rendering annotates the nearest host surfaces with `data-fig-vt-name` and optional `data-fig-vt-class`.

A Suspense fallback and its streamed primary content begin from the same name cursor, so the reveal can morph one into the other. Later surfaces use a watermark to avoid reusing those names.

Deep branches that suspend more than once may still collide. The browser skips that pair without breaking the reveal.

The inline Suspense operations `s`, `c`, and `ac` collect old and new annotated surfaces and perform their existing DOM move inside a native transition. They share the same mutex as client commits. Browsers without the API use the normal reveal path.

## Known Gaps

- A boundary shifted only by an inserted sibling may not be collected unless its parent also has work.
- A boundary whose every change belongs to a nested boundary has no change of its own, so it is not collected and its own box does not interpolate. Wrapping a resizing frame around individually named children therefore animates the children while the frame snaps; name the frame instead and let its old and new images carry the children.
- Content updates always animate; Fig does not yet remove width/height animation when size is unchanged.
