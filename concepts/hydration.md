# Hydration

Status: stable core; hydration-environment exploring

Selective hydration, event replay, mismatch policy, and the open
hydration-environment design.

## Selective Hydration

Hydration is Suspense-boundary selective: server markers can stay dehydrated
until background work or interaction hydrates that boundary.
`hydrateRoot` requires the hydration host hooks at creation (fig-dom parses
the streaming markers into `DehydratedSuspenseBoundary` objects — see
suspense-streaming.md). A dehydrated boundary whose hydration attempt
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
with dehydrated content triggers its hydration at input priority.

## Mismatch Policy

Server-only attributes and styles are preserved (extensions and edge-injected
markers survive), with a dev warning when they diverge from the client
render; text mismatches recover with a root client render (reported through
`onRecoverableError`, digests included). There is deliberately **no**
`suppressHydrationWarning` clone — see the exploration below.

## Exploring: Hydration-Stable Environment

Environment-dependent first renders (time, locale, time zone, color scheme,
viewport) are the legitimate mismatch class. The direction is a
hydration-stable environment primitive rather than a mismatch opt-out: the
app captures the environment values that affect HTML on the server,
serializes them with the document, and the client's hydration render reads
that same snapshot; after hydration, browser-backed stores publish live
values through normal subscription flow (the `useExternalStore`
server-snapshot pattern, made first-class).

Sketch (fig-start level):

```ts
createRequestHandler({
  hydrationEnv(request) {
    return {
      locale: request.headers.get("accept-language") ?? "en-US",
      colorScheme: themeFromCookie(request) ?? "light",
      now: Date.now(),
    };
  },
});
```

Open questions: ownership (fig-start vs fig-dom vs a core primitive), one
app-wide snapshot vs nested scopes, how the client learns hydration finished
(to switch to live values), whether the snapshot rides the fig-start
bootstrap path or a renderer-level slot, whether color scheme additionally
needs a pre-hydration `<html>` mutation helper against first-paint flashes,
and whether bare `hydrateRoot` should accept a snapshot option.

Provisional stance: do not add a `suppressHydrationWarning` clone — it is
easy to add later and hard to remove. Prototype the environment snapshot in
fig-start first; if a divergence class remains that cannot be modeled as
snapshot-plus-post-hydration-update, add a smaller, named escape hatch for
that class rather than a universal mismatch silencer.

Prior art surveyed: React/Next (placeholder-until-mount, client-only,
`suppressHydrationWarning`), Vue 3.5 (`data-allow-mismatch` — the explicit
escape-hatch model), Nuxt (steering toward server/client-stable sources),
and `useSyncExternalStore`'s dual-snapshot pattern, which is the closest
shape to the proposal.
