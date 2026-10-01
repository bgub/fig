# Hydration

Status: stable core; hydration-environment exploring

Hydration attaches Fig fibers to server-rendered DOM. Suspense boundaries can hydrate independently, events wait for the boundary they need, and recoverable mismatches fall back to client rendering.

## Selective Hydration

Server Suspense markers let a boundary stay dehydrated after the outer shell becomes interactive. `hydrateRoot` requires the renderer's hydration hooks up front; Fig DOM parses those markers into `DehydratedSuspenseBoundary` objects.

If hydration inside a boundary suspends, Fig leaves its server DOM untouched. The promise wakes another hydration attempt when it settles. Fig never replaces preserved server content with the boundary's fallback.

After a fallback has committed on the client, later Suspense retries use low-priority retry lanes. A retry that suspends again reuses the boundary's retry lane.

The hydration cursor skips only Fig's `<!--,-->` adjacent-text separators. It never skips Suspense markers.

`hydrateRoot` may adopt a data store prepared before rendering by a router. The renderer attaches scheduling to that same store, so route loaders and component `readData` calls share one cache. Fig DOM also accepts a `Document` container for full-document hydration. Recovery preserves its doctype and reuses the existing `html`, `head`, and `body` singletons; loaded stylesheets, style elements, and scripts remain connected while mismatched content is rebuilt.

Dehydrated Suspense and Activity boundaries capture their canonical `useId` path when they claim a server marker. Later hydration restores that path instead of using a live fiber index that intervening updates may have shifted. Suspense's private Activity fiber is transparent because it has no server counterpart, and purely client-mounted components use the separate `fig-C-*` namespace.

Single-text host children hydrate as text fibers and keep that shape. Fig does not collapse them into a `textContent` shortcut on the next update, because doing so would replace identical DOM and create a fake mutation for view transitions.

## Event Replay

Clicks, key events, and pointer events targeting a dehydrated boundary are queued and replayed after that boundary hydrates. Capture listeners also let an interaction request hydration at the event's priority.

Once a root has no dehydrated Suspense boundaries, Fig removes those listeners and clears the selective-hydration callback.

To find the blocked boundary, Fig DOM walks outward from the event target and matches surrounding marker comments. A per-root map resolves a start marker to its live boundary.

If the marker belongs to a boundary nested inside another dehydrated boundary, the search continues outward. This keeps lookup local to the target instead of scanning the application tree.

Renderers without this host lookup can fall back to searching the fiber tree.

## Form State Adoption

Typing, autofill, and selection changes can happen before the bundle loads or while a Suspense boundary remains dehydrated. Hydration respects the field's ownership:

- **Uncontrolled fields:** automatically preserve browser state. The browser owns their value.
- **Controlled fields with adoption or a binding:** preserve the edit and synchronously update application state.
- **Controlled fields without adoption:** apply application state during hydration.

For checkbox/radio inputs, `checked` establishes controlled ownership; their `value` names the choice. For other editable inputs, textareas, and selects, `value` establishes controlled ownership. `defaultValue` and `defaultChecked` do not establish controlled ownership. A binding opts in by composing `adoptFormState()` with its setter and native listeners. An ordinary DOM `bind` callback or native listener alone does not opt into preservation of a controlled field.

Fig detects edits against the **browser-normalized SSR baseline**, captured before client props or binds change defaults: input value/checked attributes, textarea default text (including children), and select default selections. Input constraints and implicit browser defaults participate in normalization. An untouched field takes the client's initial state even if it differs from server markup; that mismatch does not imply a user edit. File inputs and non-editable input types do not infer adoption.

DOM preservation does not dispatch `input`, `change`, or `click`. Those handlers keep their native timing and receive actual platform events. Controlled applications explicitly adopt pre-hydration state with `adoptFormState()` from `@bgub/fig-dom`:

```tsx
import { useState } from "@bgub/fig";
import { adoptFormState, on } from "@bgub/fig-dom";

function Field() {
  const [value, setValue] = useState("Server");
  return (
    <input
      value={value}
      mix={[
        adoptFormState((node, signal) => {
          if (!signal.aborted) setValue(node.value);
        }),
        on("input", (event) => {
          setValue((event.currentTarget as HTMLInputElement).value);
        }),
      ]}
    />
  );
}
```

The mixin accepts input, textarea, and select hosts. Its callback receives the live native node and an `AbortSignal`, returns nothing, and runs once for an edited field after successful hydration. It does not run on client mounts, unchanged hydration, or subsequent renders. Both controlled and uncontrolled fields may opt in; radios adopt only the selected member. Multiple adopters run in mixin order, with stable structural slots. A callback's signal aborts when its callback identity changes, its mixin is removed, or its node unmounts. Adoption is a notification of current state, so development does not duplicate it like a first-time bind.

Callbacks run outside commit, with discrete priority, batching, and the root's data scope, before follow-up synchronous renders queued by binds or `useBeforePaint`. They may call `flushSync`. All edited fields stay protected while the batch runs, including during re-entrant commits; synchronous adoption updates flush before protection ends, then the latest committed writes apply. Applications must update controlled state synchronously in the callback. Async or transition-deferred adoption is unsupported: once protection ends, an ordinary controlled render can reset the field. A controlled field without an adopter applies application state during hydration, preventing divergence between its live DOM state and application state. Uncontrolled fields retain their default-only ownership.

A checkbox/radio click that triggers hydration exposes tentative checked state. Fig retains field protection through click dispatch and inspects the final state after browser activation/cancellation. It starts at the next microtask; if dispatch is still active at a trusted event's between-listener microtask checkpoint, it waits for the next task. Cancelled activations send no adoption notification. Actual `input`/`change` events deliver normally, and adoption does not replay clicks or suppress native events. Follow-up renders may run while activation is pending, but their writes to protected fields wait until adoption finishes.

Abandoned hydration and removed targets send no adoption notification. Structural recovery creates new controls and cannot preserve edits in replaced DOM. Callback errors report globally without stopping other adopters or treating the callback failure as a hydration failure; see [errors](./errors.md).

The reconciler timing follows the principle of React's experimental [replay between commits](https://github.com/react/react/pull/33130). Fig's explicit adoption callback preserves its own native event contract.

## Mismatch Recovery

Fig handles mismatch types differently:

- Extra server attributes and styles remain in place, with a development warning. Browser extensions and edge middleware may have added them.
- Server-synthesized form attributes count as expected when they agree with client form state. In particular, `selected` on an `<option>` encodes its parent `<select>`'s `value` or `defaultValue`; hydration preserves a live selection changed by the user when the select is uncontrolled or declares adoption.
- Text mismatches recover by client-rendering the root and report through `onRecoverableError`. Without a root handler, Fig reports the error to the console.
- Structural mismatches inside a dehydrated Suspense boundary normally recover only that boundary.
- If that boundary contains a `Document`'s `<html>` element, recovery escalates to the root because a document cannot temporarily contain two document elements.

`unsafeHTML` is an opaque trusted subtree. Fig validates the client prop but does not compare or rewrite `innerHTML` during hydration because browser serialization is not stable across equivalent HTML.

`suppressHydrationWarning` is a narrow compatibility escape hatch. It suppresses direct text and attribute warnings on one host element, but not structural mismatches, component output, or deeper descendants. It never becomes a DOM attribute.

Request-known document state belongs in the server shell. For example, a cookie-backed theme should render on `<html>` rather than be patched by a hydration script.

## Exploring: A Stable Hydration Environment

Time, locale, time zone, and viewport are harder: the server and browser may legitimately compute different first renders.

The likely solution is a hydration-stable environment snapshot:

1. The server captures the environment values that affected its HTML.
2. The framework serializes that snapshot with the document.
3. The first client render reads the same values.
4. After hydration, browser-backed stores publish live values normally.

This is the `useSyncExternalStore` server-snapshot pattern made easier to use.

```ts
createRequestHandler({
  hydrationEnv(request) {
    return {
      locale: request.headers.get("accept-language") ?? "en-US",
      now: Date.now(),
    };
  },
});
```

Values already known from the request should not use this mechanism. A color preference can come from a cookie, while `system` color mode can remain a CSS media query.

Open decisions include who owns the API, whether snapshots may be nested, how the client switches to live values, and whether bare `hydrateRoot` needs an option.

The provisional direction is to prototype this in TanStack Start while keeping `suppressHydrationWarning` narrow. Add another escape hatch only if a real mismatch cannot be represented as a snapshot followed by a normal client update.
