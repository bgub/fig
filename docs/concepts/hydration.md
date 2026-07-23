# Hydration

Status: stable core; hydration-environment exploring

Hydration attaches Fig fibers to server-rendered DOM. Suspense boundaries can hydrate independently, events wait for the boundary they need, and recoverable mismatches fall back to client rendering.

## Selective Hydration

Server Suspense markers let a boundary stay dehydrated after the outer shell becomes interactive. `hydrateRoot` requires the renderer's hydration hooks up front; Fig DOM parses those markers into `DehydratedSuspenseBoundary` objects.

If hydration inside a boundary suspends, Fig leaves its server DOM untouched. The promise wakes another hydration attempt when it settles. Fig never replaces preserved server content with the boundary's fallback.

After a fallback has committed on the client, later Suspense retries use low-priority retry lanes. A retry that suspends again reuses the boundary's retry lane.

The hydration cursor skips only Fig's `<!--,-->` adjacent-text separators. It never skips Suspense markers.

`hydrateRoot` may adopt a data store prepared before rendering by a router. The renderer attaches scheduling to that same store, so route loaders and component `readData` calls share one cache. Fig DOM also accepts a `Document` container for full-document hydration and preserves its doctype during recovery.

Dehydrated Suspense and Activity boundaries capture their canonical `useId` path when they claim a server marker. Later hydration restores that path instead of using a live fiber index that intervening updates may have shifted. Suspense's private Activity fiber is transparent because it has no server counterpart, and purely client-mounted components use the separate `fig-C-*` namespace.

Single-text host children hydrate as text fibers and keep that shape. Fig does not collapse them into a `textContent` shortcut on the next update, because doing so would replace identical DOM and create a fake mutation for view transitions.

## Event Replay

Clicks, key events, and pointer events targeting a dehydrated boundary are queued and replayed after that boundary hydrates. Capture listeners also let an interaction request hydration at the event's priority.

Once a root has no dehydrated Suspense boundaries, Fig removes those listeners and clears the selective-hydration callback.

To find the blocked boundary, Fig DOM walks outward from the event target and matches surrounding marker comments. A per-root map resolves a start marker to its live boundary.

If the marker belongs to a boundary nested inside another dehydrated boundary, the search continues outward. This keeps lookup local to the target instead of scanning the application tree.

Renderers without this host lookup can fall back to searching the fiber tree.

## Mismatch Recovery

Fig handles mismatch types differently:

- Extra server attributes and styles remain in place, with a development warning. Browser extensions and edge middleware may have added them.
- Text mismatches recover by client-rendering the root and report through `onRecoverableError`.
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
