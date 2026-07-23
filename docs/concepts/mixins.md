# Host Mixins

Status: exploring

Host mixins package reusable behavior for intrinsic elements. They can add props or other mixins without wrapping the element or replacing its children.

## Creating A Mixin

`createMixin` returns a descriptor factory:

```tsx
import { createMixin } from "@bgub/fig";

const labelled = createMixin((context, label: string) => ({
  "aria-label": context.props["aria-label"] ?? label,
  "data-host": context.type,
}));

<button mix={labelled("Save")} />;
```

The mixin runs when Fig creates an intrinsic element, on both the server and client. It receives the host `type` and the props composed so far. It may return host props, more mixins, or nothing.

Explicit props are the starting point. Mixins run in authoring order, and later returned props win. A mixin that wants to preserve or extend an existing value reads `context.props` first.

The authored `mix` value stays on resolved props as a reconciliation marker, but Fig never writes it to HTML or the DOM. Payload serialization removes the marker and sends only the resolved, server-safe props.

## What A Mixin May Do

Mixins are pure render-time functions. They cannot call hooks or read verbs, subscribe to anything, inspect the DOM, or cause side effects. In development, using a hook or read verb throws because it would otherwise consume a slot from the component that created the element.

State belongs in a component. Event and DOM-node lifetimes belong in returned `on()` behavior or the element's `bind` prop.

A mixin cannot return `children`, `key`, or `unsafeHTML`, so it cannot restructure the host tree. Fig stops after 1,024 descriptors and reports an error, which catches recursive mixin expansion.

## Components Decide Where `mix` Goes

On a custom component, `mix` is just another prop:

```tsx
import type { FigNode, MixinInput } from "@bgub/fig";

function Button({ mix, children }: { mix?: MixinInput; children?: FigNode }) {
  return <button mix={mix}>{children}</button>;
}
```

The component chooses which intrinsic element receives it.

## Composition And Identity

`mix` accepts one descriptor, nested arrays, and the falsy values `false`, `0`, `0n`, `""`, `null`, and `undefined`. Empty entries keep their structural positions, so toggling a conditional mixin does not shift the identities of later ones.

Returned props compose shallowly. To extend `style`, `bind`, or another structured value, read the current value from `context.props` and return the merged result. Mixins returned by another mixin run immediately afterward and keep their owner's position in the identity path.

## Built-In Mixins

`on()` from `@bgub/fig-dom` is currently the only built-in mixin:

```tsx
<button mix={[on("click", save), enabled && on("pointerenter", preload)]} />
```

Its native event and `AbortSignal` behavior belong to the [event contract](./events.md). Future built-ins should come from real behavior-composition needs, not from filling out a catalog.
