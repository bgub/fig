---
packages:
  npm:@bgub/fig-server: minor
  npm:@bgub/fig-start: patch
---

## Shared inline payload-frame transport

`@bgub/fig-server/payload` now exports the inline frame transport that
document renders use to carry payload rows to the client between HTML
chunks: `payloadFrameBootstrapScript` / `payloadFrameBootstrapCode` install
the frame-queue global, `payloadFrameScript` emits one frame as a JSON
carrier plus push script, and `getPayloadFrameStream` returns the queue on
the client — creating it and replaying document frames it missed when the
bundle ran mid-stream or without the bootstrap. Frames are caller-defined
JSON values; options scope the global name and carrier attribute, and
`nonce` flows to every emitted script.

Fig Start's document streaming now uses the shared transport instead of its
own copy of the same scripts (wire output unchanged: same global, attribute,
and frame envelope).
