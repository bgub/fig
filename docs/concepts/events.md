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

Fig maps each event to discrete, continuous, or default priority. Dispatch also runs inside the batching scope, so updates from one event commit together.

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
<input bind={(node, signal) => node.focus()} />
```

The callback returns nothing. Its signal aborts when the callback identity changes or the node unmounts; moving the node does not re-run it. `composeBind` combines several binds and accepts falsy entries.

In development, a first-time bind follows the same run, abort, and run-again check as effects. Binds run during insertion, so use `useBeforePaint` when you need layout measurement.

`on()` owns event behavior. General host-prop composition belongs to [`createMixin`](./mixins.md), while `bind` remains the direct DOM-node lifetime API.

## Fragment DOM Access

An explicit `Fragment` can bind a group of elements without adding a DOM wrapper:

```tsx
import { Fragment } from "@bgub/fig";
import type { FragmentInstance } from "@bgub/fig-dom";

function observeFields(
  group: FragmentInstance,
  signal: AbortSignal,
): undefined {
  const observer = new ResizeObserver(updateLayout);
  group.observeUsing(observer);
  signal.addEventListener("abort", () => group.unobserveUsing(observer));
}

<Fragment bind={observeFields}>
  <NameField />
  <EmailField />
</Fragment>;
```

The DOM JSX runtime infers `FragmentInstance` for inline callbacks. Core owns Fragment and its renderer-neutral props; Fig DOM owns the handle type. Shorthand `<>` cannot accept a bind.

A handle tracks the committed first-level DOM elements produced by its descendants, traversing components and nested fragments. It excludes text nodes, portals, hoisted asset nodes, and hidden Activity branches. It is not a DOM node and cannot receive host props or mixins. A group's elements may be empty, and subsequent child commits update the same handle without rerunning an unchanged bind.

- `focus(options?)` and `focusLast(options?)` search descendants in DOM order for the first or last focusable element; `blur()` blurs the active descendant.
- `getClientRects()` returns the concatenated client rectangles of first-level elements.
- `observeUsing(observer)` and `unobserveUsing(observer)` manage an IntersectionObserver or ResizeObserver across first-level elements. Membership changes attach new elements and detach removed elements automatically. Stopping observation does not disconnect the observer from unrelated targets.
- `addEventListener(type, listener, options?)` and `removeEventListener(type, listener, options?)` attach native listeners to first-level elements. `currentTarget` is the actual element. Capture identity follows native boolean/options normalization; `once` applies per element, and an aborted options signal prevents registration on future elements. These are direct native listeners; `on()` remains the API for Fig's delegated event behavior.

Binds run after host mutations and before `useBeforePaint`. Their signals abort on callback replacement, deletion, or an enclosing Activity hiding. First attachment follows the development run/abort/run check. Hiding also empties the handle and removes its observations and listeners; revealing reruns the bind on the same handle. Keyed moves retain the handle and do not rerun the bind. Deletion empties the handle permanently. Registration methods are intended for the active bind lifetime. Bind failures follow the root host-commit error path, with subscriptions released during teardown.

Server HTML rendering ignores fragment binds. Hydration binds only claimed host nodes; still-dehydrated descendants join after their own hydration commits. Payload rejects a function-valued bind, so interactive groups belong inside client references.

This initial API does not provide scrolling, synthetic group dispatch, or document-position comparisons. A Fragment is not an EventTarget or a synthetic DOM parent.
