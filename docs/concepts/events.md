# Events

Status: stable

Fig uses native browser events. The `on()` mixin declares listeners, the DOM decides how events propagate, and Fig connects that behavior to scheduling and hydration.

## Declaring A Listener

```tsx
<button mix={on("click", (event, signal) => save(event, signal))} />
```

`on()` is a host mixin, not an `onClick` prop. Arrays support multiple and conditional listeners:

```tsx
<button mix={[enabled && on("click", save), on("focusin", highlight)]} />
```

The callback receives the native event and an `AbortSignal`. The signal aborts when the handler runs again or the listener is removed, even if removal happens during dispatch. `on(type, callback, options?)` supports `capture` and `passive`; Fig owns the signal option.

Changing only the callback updates the existing listener. Changing its event type, capture mode, or passive mode replaces it. Falsy entries in nested mix arrays keep their structural positions, so toggling one listener does not shift the identities of later listeners.

## Delegation And Priority

Bubbling events are delegated at the root and dispatched through the logical Fig tree. This includes portals: an event inside a portal bubbles through the component that created it, even though the DOM nodes live elsewhere.

Fig maps each event to discrete, continuous, or default priority. Native `beforetoggle`, `toggle`, `cancel`, `close`, `reset`, `pointercancel`, and `touchcancel` events use discrete priority, so a browser-driven dismissal or cancellation settles alongside the input that follows it. A lower-priority dismissal can otherwise leave stale open state in a click render and reopen a popup the browser just closed. Dispatch also runs inside the batching scope, so updates from one event commit together.

## Native Propagation

Fig does not rewrite browser semantics:

- `focus` and `blur` do not bubble. Use `focusin` and `focusout`, or capture listeners, for ancestor tracking.
- `mouseenter` and `mouseleave` are not emulated through delegation.
- `input` fires while a value changes; `change` fires when the platform commits it. There is no React-style `onChange` remapping.

Non-bubbling events attach directly to their target element.

## Hydration Replay

If a click, key, or pointer event targets a dehydrated Suspense boundary, Fig queues it. After the boundary hydrates, Fig replays the event through the logical tree with fresh propagation state.

The initial hydration shell behaves the same way. A discrete interaction can pull the whole first hydration commit forward synchronously.

## Events Before The Bundle Loads

Server-rendered documents place a small capture script at the start of `<head>`. It records replayable events that happen before the client bundle starts. The script is marked with `data-fig-hydration-skip`, so hydration knows it has no application fiber.

The first hydration root drains the document queue and removes the temporary capture listeners. Each root claims events inside its own container; events outside every root are dropped. This preserves a user's first click even on a slow connection.

## `bind`

DOM access uses a normal prop:

```tsx
<input bind={(node, signal) => observeInput(node, signal)} />
```

The callback returns nothing. Its signal aborts when the callback identity changes or the node unmounts; moving the node does not re-run it. `composeBind` combines several binds and accepts falsy entries.

In development, a first-time bind follows the same run, abort, and run-again check as effects. Binds run during insertion, before commit-level focus/selection restoration. Use `useBeforePaint` for layout measurement and final focus or selection policy; a focus choice made by a bind during mutation can be overwritten by restoration. To migrate a focus-sensitive bind, keep its node registration in `bind` and move the focus operation into `useBeforePaint`. Native listeners also run during restoration: a listener fired by selection repair can have its focus choice overwritten by the subsequent explicit focus attempt.

`on()` owns event behavior. General host-prop composition belongs to [`createMixin`](./mixins.md), while `bind` remains the direct DOM-node lifetime API.

### Committed Host Behavior

A mixin that registers a host uses `hostBinding(context, owner, update)` from `@bgub/fig-dom`. The owner is a stable object belonging to the widget instance; the mixin's structural slot identifies the behavior on that host.

```tsx
const registeredPart = createMixin((context, registry, value) => ({
  bind: [
    context.props.bind,
    hostBinding(context, registry, (node, signal) => {
      registry.bind(node, signal, value);
    }),
  ],
}));
```

The update callback runs for each committed host update, after that host’s attributes and form properties have been applied. Callback bindings follow the same ordering; their observation of host configuration does not depend on prop or mixin order. Its signal stays live when only configuration changes. The signal aborts synchronously when the host, owner, or mixin slot is removed or replaced, and when Activity hides the host. Revealing an Activity attaches the latest committed configuration with a fresh signal. Suspended renders never publish configuration. A callback that installs long-lived work must key that work by the signal, installing cleanup once per lifetime while updating its configuration on subsequent calls.

`Bind` remains a callable `(node, signal) => undefined` callback; `BindCallback` is an alias. `composeBind(...callbacks)` still returns one callable `Bind`: it invokes its callbacks in order with the same signal, and the entire group follows that wrapper’s identity-based lifetime and development run–abort–run check. It accepts callbacks and falsy entries, not host-binding descriptions.

The additive `Binding` type describes the full host prop: a callback, a host binding, or a nested array of bindings and falsy entries. Use an array when its members need independent lifetimes, including when composing a host binding with an authored `bind`. Raw callbacks in an array retain their own identity-based lifetimes; array grouping and adding a host behavior do not restart them. Falsy callback entries retain their positions. Each array member gets its own signal and its own development run–abort–run check. Independent bindings must not depend on sharing a signal or on a grouped strict-mode invocation order.

If a binding callback throws during an update, error teardown still aborts every live binding on the removed host, including retained siblings whose update did not run.
