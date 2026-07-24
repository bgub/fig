---
packages:
  "@bgub/fig":
    replay:
      - exit-prerelease(npm:@bgub/fig)
  "@bgub/fig-dom":
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  "@bgub/fig-reconciler":
    replay:
      - exit-prerelease(npm:@bgub/fig-reconciler)
---

## Keep empty children and document assets hydration-safe

Empty string children now normalize away on both the server and client, so a
rendered empty token cannot force hydration to recover the root.

When full-document hydration does recover, declarative stylesheets, titles,
and metadata now acquire against the replacement head instead of disappearing
with the server document.
