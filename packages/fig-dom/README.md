# @bgub/fig-dom

Fig DOM renderer.

## Installation

```bash
pnpm add @bgub/fig-dom
```

## Usage

```ts
import { createRoot, hydrateRoot } from "@bgub/fig-dom";
```

`hydrateRoot(container, node)` reuses server HTML, attaches Fig DOM
bindings/events, and reports recoverable mismatches through
`onRecoverableError`.

Suspense hydration is boundary-based: server Suspense markers stay
dehydrated after the shell hydrates, then hydrate in background work or
synchronously when an interaction lands inside that boundary. Pending or
server-recovered boundaries fall back to client rendering for that boundary.

## License

MIT
