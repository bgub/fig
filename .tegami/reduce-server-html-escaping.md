---
packages:
  "@bgub/fig-server":
    type: patch
---

## Reduce server HTML escaping work

Server rendering now skips replacement work for text and attribute values that
do not contain HTML-special characters and reuses replacement callbacks for
values that require escaping. Rendered markup and escaping behavior are
unchanged.
