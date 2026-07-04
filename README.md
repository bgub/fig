# Fig

Fig is a TypeScript re-implementation of React's modern runtime model:
function components, fibers, lanes, scheduling, reconciliation, hooks,
Suspense, streaming, and hydration.

It is React-inspired, but not React-compatible by default. Fig keeps the parts
of React that make the model powerful while dropping legacy APIs and choosing
smaller Fig-specific APIs where they are clearer.

## Design

Fig treats React as a reference point, not a compatibility contract.

Principles:

- Prefer small runtime concepts over compatibility layers.
- Keep renderer behavior explicit and host-driven.
- Use native platform semantics when they are clearer than React aliases.
- Add APIs because they strengthen Fig, not because React has them.
- Fail early for invalid render inputs instead of warning after commit.

The full divergence list lives in
[docs/intentional-differences-from-react.md](./docs/intentional-differences-from-react.md);
subsystem contracts, invariants, and rationale live in
[concepts/](./concepts/README.md). Highlights:

- Effects, events, binds, transitions, actions, and data loaders all receive
  an `AbortSignal`; nothing returns a cleanup function.
- DOM events are native, declared as `events={[on("click", handler)]}`;
  propagation is native with no exceptions, and DOM access is
  `bind={(node, signal) => ...}`.
- Host props use native names (`class`, `for`, `stroke-width`), enforced by
  renderer-owned JSX types; raw trusted HTML is `unsafeHTML`.
- React's `use(resource)` splits into `readContext`, `readPromise`, and
  `readData`; data freshness has two verbs (`invalidateData`, `refreshData`)
  and explicit store handles for async flows.
- Development always strict-renders; render diagnostics throw before commit;
  batching is automatic with `flushSync` as the only escape hatch.
- Server rendering is Web-stream-first with a symmetric entry grid plus
  `prerender` for settled, script-free HTML; server errors cross the wire
  only through the `onError → { digest?, message? }` contract.
- The server-component layer is Fig's own **payload** format — not RSC, not
  Flight.

Not goals:

- Matching React's legacy or compatibility behavior.
- Providing Node-specific server stream APIs as the default SSR surface.
- Adding every React API before a Fig use case proves it belongs.

Future goal:

- Broader bundler integration for component resource manifests across server and
  client component modules.

## Packages

- [`@bgub/fig`](./packages/fig/README.md): core elements, hooks, context,
  Suspense, error boundaries, and transitions.
- [`@bgub/fig-dom`](./packages/fig-dom/README.md): browser rendering,
  hydration, delegated events, `bind`, portals, native DOM props, and
  `unsafeHTML`.
- [`@bgub/fig-server`](./packages/fig-server/README.md): streaming server
  rendering, Suspense streaming, resource hoisting, server errors, and the
  server-component payload helpers.
- [`@bgub/fig-reconciler`](./packages/fig-reconciler/README.md): renderer
  internals for custom host configs, including the cooperative task
  scheduler.

## Example

```tsx
import { Suspense, readPromise, useState } from "@bgub/fig";
import { createRoot, on } from "@bgub/fig-dom";

const message = Promise.resolve("Ready");

function Message() {
  return <span>{readPromise(message)}</span>;
}

function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <button events={[on("click", () => setCount((value) => value + 1))]}>
        Count {count}
      </button>
      <Suspense fallback={<span>Loading</span>}>
        <Message />
      </Suspense>
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing root.");

createRoot(root).render(<App />);
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Demo apps live in [`apps/`](./apps).

```bash
pnpm dev:demos
```

`pnpm dev:demos` uses Turbo only as a development-time terminal UI for the demo
apps. Vite Plus remains the build, test, and package task runner; use
`pnpm dev:demos:stream` for the non-TUI labeled stream output.

The demo sites run through Portless:

- `https://fig-demo-client.localhost`
- `https://fig-demo-ssr.localhost`
- `https://fig-demo-payload.localhost`

Use a demo package's `dev:app` script to run the underlying server without
Portless.

## License

MIT
