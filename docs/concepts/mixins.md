# Host Mixins

Status: exploring

Render-time behavior composition for intrinsic host elements. Mixins package host props and other mixins behind one descriptor without wrapping the host or changing its subtree.

## Authoring

`createMixin(type)` returns a factory whose arguments are captured in a `MixinDescriptor`. Host elements accept one descriptor, nested arrays, and falsy conditional entries through `mix`:

```tsx
import { createMixin } from "@bgub/fig";

const labelled = createMixin((context, label: string) => ({
  "aria-label": context.props["aria-label"] ?? label,
  "data-host": context.type,
}));

<button mix={labelled("Save")} />;
```

The mixin runs when an intrinsic element is created, on the server and client. It receives `{ type, props }`: the host name and props composed so far. It may return host props, more mixins, or nothing. Explicit host props form the baseline; mixins run in authoring order, and later returned props win. A mixin that wants to preserve or extend the current value reads `context.props`. The authored `mix` value stays on the resolved props as a reconciliation marker but is never emitted as a DOM/HTML attribute, and the payload serializer strips it from host props — a Payload-rendered host ships only its resolved props (`payload.md`).

Mixin functions are pure render-time code: no hooks, subscriptions, DOM reads, or side effects. In dev, calling a hook or read verb inside a mixin throws — mixins resolve inside the creating component's render, so a hook call would silently consume one of that component's hook slots. Stateful work belongs to the component; host lifetimes belong in returned `on()` or `bind` behavior. Results may not replace `children`, `key`, or `unsafeHTML`, so a mixin cannot restructure or replace the host tree. Resolution stops with an error after 1,024 descriptors to diagnose recursive mixes.

`mix` on a component is an ordinary component prop. The component decides which intrinsic element receives it:

```tsx
import type { FigNode, MixinInput } from "@bgub/fig";

function Button({ mix, children }: { mix?: MixinInput; children?: FigNode }) {
  return <button mix={mix}>{children}</button>;
}
```

## Composition And Identity

Arrays may nest and contain `false | 0 | 0n | "" | null | undefined`. Structural positions include those empty entries, so toggling an earlier conditional mixin does not change later mixin slots.

Returned props compose shallowly. A mixin that builds on `style`, `bind`, or another structured prop reads the current value from `context.props` and returns the merge. Returned mixins are appended immediately after their owner and keep the owner's slot in their identity path.

## Built-ins

`on()` from `@bgub/fig-dom` is currently the only built-in mixin:

```tsx
<button mix={[on("click", save), enabled && on("pointerenter", preload)]} />
```

It contributes a native event listener without producing server markup. Its event callback and `AbortSignal` contract remain owned by the event subsystem (`events.md`). Future built-ins need evidence from real behavior composition; `mix` is not a reason to mirror another framework's catalog.
