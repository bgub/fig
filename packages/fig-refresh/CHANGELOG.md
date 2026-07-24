## @bgub/fig-refresh@0.1.0-alpha.3

### Renderers now install their reconciler implementation

Fig DOM and Fast Refresh now depend on their exact reconciler version directly.
Applications no longer need to install `@bgub/fig-reconciler` alongside Fig DOM;
the reconciler remains a direct dependency only for custom-renderer authors.

Fast Refresh connects to Fig DOM through a renderer-owned adapter, ensuring its
family resolver and scheduled updates always reach the same reconciler instance
even when development tooling resolves through a separate package graph.

## @bgub/fig-refresh@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of Fig.
