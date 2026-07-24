---
packages:
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Streaming HTML and payload respect consumer backpressure

Server render streams — HTML and payload — now carry a byte-length queuing
strategy with a new `highWaterMark` option (default 65536 bytes). When the
stream's internal queue reaches the mark, completed Suspense content waits in
segment form (HTML) or encoded rows wait queued (payload) and flush through
the stream's pull handler as the consumer reads, so a slow connection no
longer buffers the entire remaining document in memory.
Rendering itself never pauses, and `shellReady`/`headReady`/`allReady` still
settle on task completion regardless of consumer pace. Gating sits between
boundary flushes, so every chunk still ends on complete markup. As a side
effect, boundaries that settle while the flow is blocked coalesce into a
single staged piece with one reveal op instead of partial fills.

Cancelling the stream mid-render (`reader.cancel()`) now aborts the render
cleanly instead of throwing from an enqueue into the cancelled stream.
