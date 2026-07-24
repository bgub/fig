---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-reconciler: minor
---

## Add typed View Transition scopes and abortable lifecycle events

`transition` and the `useTransition` starter now accept explicit transition
types, which Fig carries with the updates that reach each root and forwards to
the browser without leaking into unrelated commits.

`ViewTransition` adds one `onTransition(event, signal)` lifecycle callback for
enter, exit, share, and update phases. Events expose all participating surfaces
and the commit's transition types. Fig DOM's optional View Transition entry can
resolve those opaque surfaces into group, image-pair, old, and new pseudo
handles for animation and inspection; the signal aborts when the native
transition finishes.
