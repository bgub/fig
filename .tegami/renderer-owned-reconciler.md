---
packages:
  "@bgub/fig-dom": minor
  "@bgub/fig-reconciler": minor
  "@bgub/fig-refresh": minor
---

## Renderers now install their reconciler implementation

Fig DOM and Fast Refresh now depend on their exact reconciler version directly.
Applications no longer need to install `@bgub/fig-reconciler` alongside Fig DOM;
the reconciler remains a direct dependency only for custom-renderer authors.

Fast Refresh connects to Fig DOM through a renderer-owned adapter, ensuring its
family resolver and scheduled updates always reach the same reconciler instance
even when development tooling resolves through a separate package graph.
