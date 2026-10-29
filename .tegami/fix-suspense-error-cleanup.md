---
packages:
  "@bgub/fig-server":
    type: patch
---

## Preserve fallbacks and finish failed Suspense responses

Cancel nested work in discarded primary content so server errors cannot leave
streaming or prerender responses waiting on unreachable suspended tasks. Keep
suspended fallback work alive so error recovery renders the intended fallback.
