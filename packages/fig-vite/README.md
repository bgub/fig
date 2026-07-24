# @bgub/fig-vite

Vite integration for Fig. It sets Fig's compile-time development gate and
provides state-preserving Fast Refresh.

```ts
import { fig } from "@bgub/fig-vite";

const plugins = [fig()];
```

Framework adapters may install this plugin for you. In particular,
`@bgub/fig-tanstack-start/plugin/vite` includes `fig()`.

Published Fig packages select their precompiled development artifacts
automatically while Vite is serving. Applications do not need to add export
conditions or configure `__FIG_DEV__` themselves.

Host integrations may explicitly define `__FIG_DEV__` as the static value
`true` or `false`. The integration uses the same value for source transforms
and package selection, and disables Fast Refresh instrumentation when the value
is `false`. Dynamic expressions are not supported.

`figRefresh(options)` remains available when another integration already owns
the development gate and needs only the refresh transform.

The complete integration also keeps sibling Fig packages in one SSR module
graph. Fig's renderer and server packages share ambient root and request state,
so independently externalizing those packages can split one render across
different state owners.

Fig packages are ESM-only and require Node `^20.19.0 || >=22.12.0`.

## License

MIT
