## @bgub/fig-refresh@0.1.0

### Let tooling and adapters follow independent release trains

Fast Refresh and Vite now accept compatible runtime releases instead of
requiring the same exact Fig version. The TanStack Router and Start adapters do
the same while remaining pinned to matching versions within each adapter pair.

### Publish stable pre-1.0 releases

Fig's runtime, tooling, and TanStack adapter packages now publish without an
`alpha` prerelease suffix. Patch releases preserve compatibility within their
current `0.x` minor line; minor releases may make breaking changes before 1.0.

### Renderers now install their reconciler implementation

Fig DOM and Fast Refresh now depend on their exact reconciler version directly.
Applications no longer need to install `@bgub/fig-reconciler` alongside Fig DOM;
the reconciler remains a direct dependency only for custom-renderer authors.

Fast Refresh connects to Fig DOM through a renderer-owned adapter, ensuring its
family resolver and scheduled updates always reach the same reconciler instance
even when development tooling resolves through a separate package graph.

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
