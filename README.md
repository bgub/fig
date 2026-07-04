# Fig

Fig is a TypeScript re-implementation of React's modern runtime model:
function components, fibers, lanes, scheduling, reconciliation, hooks,
Suspense, streaming, and hydration.

It is React-inspired, but not React-compatible by default. Fig keeps the parts
of React that make the model powerful while dropping legacy APIs and choosing
smaller Fig-specific APIs where they are clearer.

## Design

Fig treats React as a reference point, not a compatibility contract. The
full divergence list lives in
[docs/intentional-differences-from-react.md](./docs/intentional-differences-from-react.md).

Principles:

- Prefer small runtime concepts over compatibility layers.
- Keep renderer behavior explicit and host-driven.
- Use native platform semantics when they are clearer than React aliases.
- Add APIs because they strengthen Fig, not because React has them.
- Fail early for invalid render inputs instead of warning after commit.

Deliberate divergences:

- No legacy React APIs: no class components, string refs, legacy context, or
  synthetic event pooling.
- Effects use Fig names: `useReactive`, `useBeforePaint`, and
  `useBeforeLayout`; an empty deps array is the mount-once idiom.
- Effects receive an `AbortSignal`; cleanup attaches to abort instead of being
  returned from the effect.
- No `StrictMode` component: development builds always strict-render.
  Components render twice per pass with the first result discarded, and
  first-time effects and `bind` callbacks run, abort, and run again with a
  fresh signal. Production builds strip these checks.
- DOM events use `events={[on("click", handler)]}` with native events and an
  `AbortSignal`, not `onClick` props.
- Event propagation is native, with no exceptions: non-bubbling events —
  `focus` and `blur` included — fire only on their target. Fig does not
  emulate React's bubbling `focus`/`blur`; observe focus changes from an
  ancestor with the platform's bubbling variants, `focusin`/`focusout` (or a
  `capture: true` listener, as in the real DOM).
- `useStableEvent(handler)` declares stable, non-reactive handlers (Fig's
  `useEffectEvent`): the returned function's identity never changes, the
  handler always sees the latest committed render, and it follows the Fig
  event contract — a trailing `AbortSignal`, aborted on re-entry and unmount.
- DOM node access uses `bind={(node, signal) => ...}` instead of refs.
- Host props use native DOM names such as `class`, `for`, `tabindex`,
  `stroke-width`, and `xlink:href`.
- Raw trusted HTML uses `unsafeHTML`, not `dangerouslySetInnerHTML`.
- Context reads use `readContext(context)` because context is a render input.
- Promise reads use `readPromise(promise)` rather than React's broad
  `use(resource)` API.
- Data mutations are handle-explicit across async boundaries: the
  `invalidateData`/`preloadData`/`refreshData` free functions resolve an
  ambient store that only exists while Fig executes synchronously (render,
  events, actions, effects). Async flows capture `readDataStore()` — or use
  `root.data` — and call the same methods on the handle after awaits.
- Error recovery composes without side channels: an `ErrorBoundary` `fallback`
  may be a function receiving `(error, info)` so error UIs render the failure
  and offer retry, and invalidating a rejected data entry clears the cached
  error so a remounted boundary loads afresh instead of rethrowing.
- Transitions are explicit priority scopes: `transition(callback)` and
  `useTransition()` mark updates scheduled inside the callback, including
  post-`await` updates while an async transition callback is still pending.
  `useTransition()` callbacks receive an `AbortSignal` that aborts on
  supersede (each hook is one cancellation domain), unmount, and Activity
  hide; an aborted run is retired — its pending slot releases immediately and
  its settlement (including an aborted fetch's rejection) is inert.
- `useActionState(action, initialState)` follows React's argument order, with
  Fig appending a trailing `AbortSignal` after the runner's arguments. Runs
  are last-run-wins: a new run aborts and retires the previous one, whose
  settlement can no longer touch state, error, or pending. Server action
  transport is intentionally left to a future framework layer.
- Server rendering uses Web `ReadableStream`s as the primary streaming model
  instead of Node-specific streams. This keeps the same API shape across modern
  Node, edge runtimes, Deno, Bun, and browser-like environments.
- Server render errors cross the wire only through the explicit
  `onError → { digest?, message? }` contract, shared by the HTML and payload
  renderers: the handler's payload is authoritative, production defaults to an
  empty payload, and development defaults to including the message because
  server errors never re-execute on the client.
- Document resources use explicit `resources([...], children)` wrappers and
  small helpers such as `stylesheet`, `preload`, `font`, `preconnect`, `title`,
  `meta`, and `script`; document-mode server rendering also lowers host
  `<title>`, `<meta>`, `<link>`, and `<script>` tags into the same registry.
  Metadata is injected into `<head>` while stream-safe assets can be hoisted
  near dependent segments.

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
