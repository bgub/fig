---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Keep native widget changes in step with input

Run native toggle, dialog dismissal, form reset, and pointer/touch cancellation events at discrete priority. This prevents a dismissed popover from reopening with stale state and closing another popup opened by the next click.
