---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Attach beforetoggle listeners directly

`beforetoggle` does not bubble, so `on("beforetoggle", ...)` was attached as a
delegated root listener and never fired for a popover or a dialog. It now
attaches to its element like the other non-bubbling events, `toggle` included.
