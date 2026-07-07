# Hydration

Status: stable core; hydration-environment exploring

Selective hydration, event replay, mismatch policy, and the open
hydration-environment design.

## Selective Hydration

Hydration is Suspense-boundary selective: server markers can stay dehydrated
until background work or interaction hydrates that boundary.
`hydrateRoot` requires the hydration host hooks at creation (fig-dom parses
the streaming markers into `DehydratedSuspenseBoundary` objects — see
suspense-streaming.md). The hydration cursor steps over the server's
`<!--,-->` text-separator comments when advancing (see the text-separators
section of server-rendering.md); suspense marker comments are never skipped. A dehydrated boundary whose hydration attempt
suspends **stays dehydrated**: the server DOM is preserved and the attached
thenable ping retries hydration; no fallback is ever rendered over server
content. Suspense retries after a committed fallback schedule on retry
lanes — low priority, excluded from expiration, reusing the boundary's retry
lane when a retry suspends again.

## Event Replay

Replayable events (click, key, pointer) that target a still-dehydrated
boundary are queued and replayed after that boundary hydrates — a synthetic
two-phase dispatch through the logical tree (see events.md). Hydration
listeners are separate capture-phase listeners per root, covering the
discrete/continuous sets plus focus and enter/leave events, so interacting
with dehydrated content triggers its hydration at input priority. Once a root
has no remaining dehydrated Suspense boundaries, the host tears down those
capture listeners and clears the selective-hydration callback.

## Mismatch Policy

Server-only attributes and styles are preserved (extensions and edge-injected
markers survive), with a dev warning when they diverge from the client
render; text mismatches recover with a root client render (reported through
`onRecoverableError`, digests included). `unsafeHTML` is trusted as an opaque
server subtree during hydration: Fig validates the client prop shape but does
not raw-compare or reassign `innerHTML`, because browser serialization is not
stable across equivalent HTML. Host elements support React's
`suppressHydrationWarning` prop as a one-level escape hatch for intentional
direct text/attribute divergence on that host element; it does not suppress
structural mismatches, descendant component output, or deeper host children,
and is not rendered as a DOM attribute. Fig Start owns the document shell and
lets apps supply per-request `<html>` props; request-known shell state like a
cookie-backed theme should be rendered there instead of patched by a
hydration script.

## Exploring: Hydration-Stable Environment

Environment-dependent first renders (time, locale, time zone, viewport) are
the legitimate mismatch class. The direction is a hydration-stable
environment primitive rather than a mismatch opt-out: the app captures the
environment values that affect HTML on the server,
serializes them with the document, and the client's hydration render reads
that same snapshot; after hydration, browser-backed stores publish live
values through normal subscription flow (the `useExternalStore`
server-snapshot pattern, made first-class).

Values the server can already know from the request should stay outside this
primitive. For example, color scheme should usually be a cookie-backed app
preference rendered into the Fig Start document shell, with `system` resolved
by CSS media queries.

Sketch (fig-start level):

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

Open questions: ownership (fig-start vs fig-dom vs a core primitive), one
app-wide snapshot vs nested scopes, how the client learns hydration finished
(to switch to live values), whether the snapshot rides the fig-start
bootstrap path or a renderer-level slot, and whether bare `hydrateRoot` should
accept a snapshot option.

Provisional stance: keep `suppressHydrationWarning` compatible but narrow.
Prototype the environment snapshot in fig-start first; if a divergence class
remains that cannot be modeled as snapshot-plus-post-hydration-update or a
one-level host escape hatch, add a smaller, named escape hatch for that class
rather than a broader mismatch silencer.

Prior art surveyed: React/Next (placeholder-until-mount, client-only,
`suppressHydrationWarning`), Vue 3.5 (`data-allow-mismatch` — the explicit
escape-hatch model), Nuxt (steering toward server/client-stable sources),
and `useSyncExternalStore`'s dual-snapshot pattern, which is the closest
shape to the proposal.
