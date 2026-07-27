---
packages:
  npm:@bgub/fig-tanstack-router:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
---

## Skip protocol parsing for generated internal links

Router-generated internal links are safe by construction and no longer pass
through WHATWG `URL` parsing during render. Absolute targets, explicit `href`
values, and locations marked external still receive the same dangerous-protocol
validation.

This removes repeated URL construction from link-heavy SSR pages while
preserving link output and navigation behavior.
