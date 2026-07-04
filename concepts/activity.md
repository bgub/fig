# Activity

Status: stable

`<Activity mode="visible" | "hidden">` hides a subtree while preserving fiber
and hook state.

## Hiding And Revealing

Hiding applies the host `hideInstance`/`unhideInstance` hooks (through
portals, stopping at nested hidden boundaries) and **aborts** effects, binds,
stable events, and in-flight transitions/actions — the aborted signal is the
visibility indicator; there is no visibility API. Revealing re-arms deferred
effects (kept on `fiber.effects` while hidden and skipped by the commit
effect walks) so they run in normal phase order; external-store subscriptions
defer until reveal. Trees that mount hidden never run effects until revealed.

## Offscreen Scheduling

Updates inside hidden trees are downgraded to the offscreen lane at schedule
time — visibility is read from a commit-updated `ActivityState` shared by
both fiber generations, so stale dispatch chains stay authoritative — and
prerender at idle priority into the hidden DOM, with prerendered placements
and host updates re-hidden as they commit. A reveal expands the render lanes
so pending hidden work commits atomically with the reveal; offscreen work
skipped by earlier bailouts is re-marked pending after commit. Retired
transition/action pending slots release on hide (scheduled at the hidden
tree's downgraded lane) so a revealed tree is never stuck `isPending`.

## Server Rendering And Hydration

The server streams hidden Activity content inside an inert
`<template data-fig-activity>` so neither elements nor bare text render
before hydration. The client keeps such boundaries dehydrated — no fibers,
hooks, or hydration work — until reveal (or a visible client mode), when the
content hydrates against the template's nodes and the commit unpacks them
into the live DOM with node identity preserved. Any throw during Activity
hydration abandons the attempt and the boundary stays dehydrated for a clean
retry; hydration mismatches recover with a root client render.

Suspense that suspends inside hidden server content still streams its
completion: the boundary's markers live in the activity's inert `<template>`
(whose content fragment is unreachable by the id-based reveal scripts), so
its partial segments stage and fill in light-DOM hidden divs like any
boundary, and a final `ac` op moves the assembled content into the template
content (falling back to the light DOM if the activity already revealed),
leaving a completed boundary that hydrates normally on reveal. A server
render error inside such content emits an `ax` client-render marker into the
same template content, with the same light-DOM fallback after early reveal.
