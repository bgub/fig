---
packages:
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Release server-rendered chunks after flushing

Server rendering now releases a segment's serialized fragments as soon as
they are flushed, reducing retained memory for large responses.
