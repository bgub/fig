# Lifecycle

The last doc explained how Fig builds and schedules a new tree. This doc explains what application code observes as that tree becomes real: when updates batch, when components run, when the DOM changes, and when effects start and stop.

## Triggering an update

Calling a state setter does not immediately call your component or change the DOM. It adds an update to the hook's queue, assigns it a lane, and schedules work on the root.

Fig automatically batches updates from the same event or tick. These two setters produce one render:

```tsx
on("click", () => {
  setCount((count) => count + 1);
  setOpen(true);
});
```

Even a `SyncLane` update is normally scheduled rather than performed inside the setter. "Sync" means that once its render starts, Fig does not time-slice it. `flushSync` is the stronger escape hatch: it renders and commits pending work before returning, which is occasionally useful when imperative code must read the updated DOM immediately.

## Render is a draft

During render, Fig calls components and builds the work-in-progress tree from the previous committed tree. Render may pause, restart from the root, run at a different priority, or be abandoned without ever reaching the screen.

This is why component functions must be pure. Rendering does not change the DOM, attach `bind` callbacks, or run effects. It only calculates the next tree and records what a later commit would need to do. If Fig abandons that render, it can throw the whole draft away without undoing anything visible.

Effects are prepared during render: Fig compares their dependency arrays and records the ones that need to run. Preparing an effect is not the same as running it. Only a committed render gets effects.

## Commit makes it real

Once a render finishes, Fig commits it synchronously. Commit never yields halfway through, so the browser cannot paint a half-updated tree.

The normal order is:

```text
publish stable handlers
useBeforeLayout
DOM deletions, insertions, and updates + bind
root.current = finishedWork
useBeforePaint
browser paints
useReactive
```

By the time `useBeforePaint` runs, the new DOM is in place, `bind` callbacks have attached, and the finished fiber tree is current. `useReactive` is scheduled separately so the browser gets an opportunity to paint first.

There is one important exception to that last line: if another render starts before pending reactive effects have run, Fig flushes them first. A reactive effect may be delayed past paint, but never past the next render.

## The three effect hooks

The names describe where each hook sits in that timeline:

| Hook | When it runs | Use it for |
| --- | --- | --- |
| `useBeforeLayout` | before DOM mutations | inserting CSS rules that the incoming DOM needs |
| `useBeforePaint` | after DOM mutations, before paint | measuring layout or making a visual adjustment the user must not see halfway |
| `useReactive` | normally after paint | subscriptions, network synchronization, timers, logging, and other non-visual work |

Most effects should use `useReactive`. `useBeforePaint` blocks the browser from painting, so work there should be small. `useBeforeLayout` is an even narrower CSS-in-JS slot: the new DOM does not exist yet, and scheduling state from it is a development error.

State scheduled from `useBeforePaint` flushes synchronously before the browser paints. This lets a measurement trigger one final render without showing the intermediate layout, but it also means an expensive update there will block the frame.

## Cleanup is an abort

Every effect invocation receives a fresh `AbortSignal`. It must return `undefined`; returning a React-style cleanup function is a type error.

When dependencies change, Fig aborts the previous signal before calling the effect again. It also aborts on unmount and when an `Activity` subtree hides. If the dependencies did not change, the effect stays alive and its signal does not abort.

APIs like `fetch` already understand signals. For imperative cleanup, listen for the abort:

```tsx
useReactive(
  (signal) => {
    const socket = new WebSocket(`/rooms/${roomId}`);

    socket.addEventListener("message", receiveMessage);
    signal.addEventListener("abort", () => socket.close(), { once: true });
  },
  [roomId],
);
```

The signal is the source of truth everywhere in Fig. Dependency changes and unmounts do not need separate cleanup protocols; both abort the lifetime that just ended.

## DOM access and stable events

`bind` follows the same lifetime model, but it is tied to a DOM node instead of an effect. Its callback runs during the DOM mutation part of commit, so the node is available by the time `useBeforePaint` runs. Its signal aborts when the binding identity changes, the node unmounts, or its `Activity` subtree suspends.

`useStableEvent` works in the other direction: the returned function keeps one identity, while commit publishes the handler from the newest finished render. An abandoned render never leaks a handler that closes over state the user cannot see.

## Unmounting and hiding

When a subtree unmounts, Fig releases its data and external-store subscriptions, aborts its effects and other component-owned work, detaches events and binds, and removes its DOM. Abort listeners run before the corresponding DOM nodes are removed, so cleanup can still inspect them if necessary.

Hiding an `Activity` is different from unmounting. The state, fibers, and DOM stay around, but Fig aborts or suspends the work that should not remain live while hidden. Effects and binds start again when the subtree is revealed.

Errors thrown by effects go to the nearest `ErrorBoundary`, just like render errors. Event-handler errors and errors from asynchronous code remain the caller's responsibility.

## Development behavior

Fig has no `StrictMode` component and no opt-out. Development rendering is always strict:

- Every component render runs twice. The first invocation is a shadow pass that Fig discards; only the second can commit.
- The first time an effect or `bind` callback runs, Fig immediately aborts it and runs it again with a fresh signal.
- Invalid render input, including duplicate keys, render-phase state updates, invalid children, and invalid DOM nesting, throws before commit.

The goal is to expose impure rendering and code that ignores its `AbortSignal` before it reaches production. Server rendering does not double-run, and production builds strip the development checks.

Next: doc 4 — what changes when a render suspends, streams from the server, or hydrates existing HTML.
