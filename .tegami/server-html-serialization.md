---
packages:
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Batch server-rendered opening tags

Server HTML rendering now serializes each host opening tag and its attributes
into one segment chunk. Attribute-heavy trees avoid per-attribute segment and
flush-buffer entries while preserving byte-identical HTML output.
