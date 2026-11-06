---
packages:
  "@bgub/fig-server":
    type: patch
---

## Terminate streams when disposal fails

Terminate HTML and Payload streams when data transfer fails during disposal. Preserve the original render or cancellation error when disposal also throws, after completing data-store cleanup.
