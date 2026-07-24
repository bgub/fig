---
packages:
  npm:@bgub/fig-tanstack-router:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
---

## Keep outgoing route hooks valid through unmount

Route-scoped hooks now retain their mounted match while navigation replaces the
active match list. Outgoing routes can subscribe to router state without
throwing during browser back navigation and clearing the rendered page.
