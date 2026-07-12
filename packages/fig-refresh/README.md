# @bgub/fig-refresh

Fast Refresh runtime for [Fig](https://github.com/bgub/fig). It tracks
component families across module re-evaluations and installs the refresh
handler that lets the reconciler swap implementations in place while
preserving state.

This package is wiring, not an API you call from application code: build
tooling (such as `@bgub/fig-vite`) injects `register`/`setSignature` calls
into transformed modules and drives `performRefresh` on hot updates.

See the repository's `docs/concepts/` directory for the underlying contracts.

## Installation

```bash
pnpm add @bgub/fig-refresh
```

Fig packages are ESM-only and require Node `^20.19.0 || >=22.12.0` for Node runtime entry
points.

## License

MIT
