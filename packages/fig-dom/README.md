# @bgub/fig-dom

Fig DOM renderer.

## Installation

```bash
pnpm add @bgub/fig-dom
```

## Usage

```ts
import { createPortal, createRoot, hydrateRoot } from "@bgub/fig-dom";
```

`hydrateRoot(container, node)` reuses server HTML, attaches Fig DOM
bindings/events, and reports recoverable mismatches through
`onRecoverableError`.

Suspense hydration is boundary-based: server Suspense markers stay
dehydrated after the shell hydrates, then hydrate in background work or
synchronously when an interaction lands inside that boundary. Pending
boundaries stay dehydrated until the server completes them, while
server-recovered boundaries schedule client rendering for that boundary.

`createPortal(children, container, key?)` renders children into an existing DOM
container while keeping context, effects, and delegated events attached to the
logical Fig tree.

## License

MIT
