# Events

Status: stable

The `events` prop, delegation through the logical tree, and native propagation semantics.

## The API

Listeners are declared as `events={[on("click", (event, signal) => ...)]}` — an array of `on()` descriptors, not `onClick` props. Callbacks receive the **native** event plus an `AbortSignal` that aborts on re-entry and on listener removal (enforced even mid-dispatch). `on(type, callback, options?)` supports `capture` and `passive` (`signal` is excluded — Fig owns the signal). Callback identity swaps in place without listener churn.

Array entries may be `false | null | undefined` (conditional listeners), and array position is a listener's identity: slots match by index, so a key change (type/options) at a position tears down and recreates that slot.

## Delegation

Bubbling events are delegated at the root and dispatched through the _logical_ Fig tree — portals included: portal targets mirror their logical parent's delegated listener keys (cascading through nested portals) so portal-inner events always bubble logically. Handlers run at event-mapped lane priority (`discrete`/`continuous`/`default`) and inside the batching scope, so same-event updates coalesce.

## Native Propagation, No Exceptions

Non-bubbling events attach directly to their element and fire only on their target — `focus` and `blur` included. Fig does not emulate React's bubbling `focus`/`blur` (nor `mouseenter`/`mouseleave` delegation, nor the onChange-that-is-really-onInput remapping; a dev warning steers `onChange` habits to `on("input")`). Ancestor focus tracking uses the platform's bubbling `focusin`/`focusout` — which delegate through the logical tree like any bubbling event — or a `capture: true` listener, exactly as in the real DOM.

## Replay

Selective hydration queues replayable events (click, key, pointer) that target a still-dehydrated Suspense boundary and replays them after the boundary hydrates — a synthetic two-phase dispatch through the logical tree, with per-dispatch propagation state so a spent native event's stale `cancelBubble` cannot drop the replay. Targets in a shell whose first hydration commit hasn't landed are blocked the same way; a discrete interaction pulls the whole initial hydration forward synchronously.

## Early Capture (Pre-Bundle Events)

Server-rendered documents open `<head>` with a tiny inline script that queues replayable events fired before the client bundle executes (the `EARLY_EVENT_*` contract in `@bgub/fig/internal`). The first hydration root drains the document's queue, removes the capture listeners, and each root claims the events inside its container into the standard replay queue — so a user's first click is honored instead of lost, no matter how slowly the bundle arrives. Unclaimed events (targets outside any root) are dropped at replay time. Documents without a client bundle just carry a small inert array.

## bind

DOM node access is `bind={(node, signal) => ...}`, forwarded as a normal prop — no `forwardRef`, no ref objects. Bind callbacks return `undefined`: cleanup belongs on the signal, and returned cleanup functions or promises are type errors. The signal aborts on identity change and unmount; DOM _moves_ do not re-fire it. `composeBind` merges binds and accepts falsy entries. Strict dev runs first-time binds through the run/abort/re-run cycle like effects. (Note: binds fire during insertion; use `useBeforePaint` for layout measurement.)

## Styling Stays Separate

Styling is deliberately not part of the `events` or `bind` APIs: `style` is its own prop (string-valued object — see jsx.md), and neither descriptors nor bind callbacks grow styling conveniences. One prop kind per concern.
