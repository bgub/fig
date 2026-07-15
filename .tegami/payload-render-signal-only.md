---
packages:
  npm:@bgub/fig-server: minor
---

## `renderToPayloadStream` cancels through its signal only

The payload render result no longer carries an `abort()` method; it is
`{ stream, allReady, contentType }`. Cancellation is signal-only, matching
the payload decoder: pass `signal` in the render options (or cancel the
stream) to abort a hung payload render and reject `allReady`. The HTML
renderer keeps its `abort()` method, whose semantics are genuinely distinct
there (it delivers client-render ops for pending boundaries to a live
consumer); on the payload side it was a third spelling of the same
cancellation.
