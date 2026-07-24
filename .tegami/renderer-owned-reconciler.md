---
packages:
  "@bgub/fig-dom":
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  "@bgub/fig-reconciler":
    replay:
      - exit-prerelease(npm:@bgub/fig-reconciler)
  "@bgub/fig-refresh":
    replay:
      - exit-prerelease(npm:@bgub/fig-refresh)
---

## Renderers now install their reconciler implementation

Fig DOM and Fast Refresh now depend on their exact reconciler version directly.
Applications no longer need to install `@bgub/fig-reconciler` alongside Fig DOM;
the reconciler remains a direct dependency only for custom-renderer authors.

Fast Refresh connects to Fig DOM through a renderer-owned adapter, ensuring its
family resolver and scheduled updates always reach the same reconciler instance
even when development tooling resolves through a separate package graph.
