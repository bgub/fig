# View Transitions

Status: exploring

`ViewTransition` marks DOM surfaces that may animate during a native browser view transition. It adds no wrapper element and does nothing unless an eligible client commit or server reveal changes that surface.

## Public API

`ViewTransition` is a branded component exported by `@bgub/fig`:

```tsx
import { ViewTransition } from "@bgub/fig";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";

enableViewTransitions();

<ViewTransition name="article" enter="slide-in" exit="slide-out">
  <Article />
</ViewTransition>;
```

`enableViewTransitions()` activates native DOM View Transitions for the current application. It is permanent and idempotent, may run after roots exist, and may live in the module that first renders a transition surface, including a lazy route. Importing the module alone does not activate the feature. The ordinary `@bgub/fig-dom` entry includes neither the View Transition planner nor the browser adapter.

In development, rendering a `ViewTransition` before installing a coordinator that declares `viewTransitions: true` reports a one-time renderer-neutral diagnostic; its Fig DOM guidance points to `enableViewTransitions()`. Production continues to degrade to ordinary rendering when that support is absent.

`ViewTransition` itself stays in core because it is a renderer-neutral boundary. `@bgub/fig-reconciler/view-transitions` owns the optional planning and commit-coordination module; `@bgub/fig-dom/view-transitions` combines that planner with the browser host and explicitly installs the resulting coordinator on Fig DOM's existing renderer.

Its props are:

- `name?: string` — an explicit `view-transition-name`; missing or `"auto"` uses a generated name.
- `default`, `enter`, `exit`, `share`, and `update` — each accepts `"auto"`, `"none"`, or a class string.
- `children?: FigNode`.

`"auto"` keeps browser/default styling. `"none"` disables that phase. Empty names and `name="none"` are reserved and throw in development.

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

## Root Snapshot

The browser captures the whole page by default. Fig cancels that root snapshot when all layout changes are already covered by named surfaces. Untouched regions then remain live and interactive while those groups animate.

Changes outside a transition boundary, parent-affecting size changes, or shortened surface lists keep the root snapshot. Pure keyed moves may still cancel it because the moved surfaces animate on their own.

Root-name restoration and temporary hide animations remain in place until `finished`, not merely `ready`. Restoring the root name during an active animation can reconnect the live page to a hidden captured group and briefly paint the page blank.

## One Transition At A Time

Client commits and annotated server reveals share a per-document `__figViewTransition` mutex. A new eligible commit waits for the current animation to finish instead of calling `skipTransition()` and producing a stutter.

Only commit waits. Rendering continues normally:

1. An eligible tree finishes while another transition is active.
2. Fig parks it before any commit phase or effect runs.
3. A newer render may replace that parked tree.
4. When the animation finishes, the latest state commits and starts the next transition.

Urgent sync and default-lane commits never park. Unannotated server reveals do not park either. A 60-second safeguard releases a commit or reveal if the prior browser transition never settles.

Once the browser invokes a deferred transition callback, the root remains frozen only for that short capture window. Errors thrown there follow the normal root uncaught-error path. Hosts without the reconciler's suspension hook fall back to the same chained wait in Fig DOM.

## Server Streaming

Server rendering annotates the nearest host surfaces with `data-fig-vt-name` and optional `data-fig-vt-class`.

A Suspense fallback and its streamed primary content begin from the same name cursor, so the reveal can morph one into the other. Later surfaces use a watermark to avoid reusing those names.

Deep branches that suspend more than once may still collide. The browser skips that pair without breaking the reveal.

The inline Suspense operations `s`, `c`, and `ac` collect old and new annotated surfaces and perform their existing DOM move inside a native transition. They share the same mutex as client commits. Browsers without the API use the normal reveal path.

## Known Gaps

- No transition types, lifecycle callbacks, gestures, or pseudo-element refs.
- A boundary shifted only by an inserted sibling may not be collected unless its parent also has work.
- Content updates always animate; Fig does not yet remove width/height animation when size is unchanged.
