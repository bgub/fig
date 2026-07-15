---
packages:
  npm:@bgub/fig-server: patch
---

## Batch server-rendered opening tags

Server HTML rendering now serializes each host opening tag and its attributes
into one segment chunk. Attribute-heavy trees avoid per-attribute segment and
flush-buffer entries while preserving byte-identical HTML output.
