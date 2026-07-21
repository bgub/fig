# @bgub/fig-vite

Vite integration for Fig. It provides state-preserving Fast Refresh and the
`serverDataResource` packaging transform.

```ts
import { figData, figRefresh } from "@bgub/fig-vite";

const plugins = [figRefresh(), figData()];
```

Framework adapters may install these plugins for you. In particular,
`@bgub/fig-tanstack-start/plugin/vite` includes `figRefresh()`.

Fig packages are ESM-only and require Node `^20.19.0 || >=22.12.0`.

## License

MIT
