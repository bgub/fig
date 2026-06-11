# @bgub/fig

Core primitives for Fig, a TypeScript re-implementation of React's modern
component model. Renderers live in `@bgub/fig-dom` and `@bgub/fig-server`.

## Installation

```bash
pnpm add @bgub/fig
```

## Usage

```tsx
import { createRoot, on } from "@bgub/fig-dom";
import { Suspense, readPromise, useState } from "@bgub/fig";

const message = Promise.resolve("Ready");

function Message({ value }: { value: Promise<string> }) {
  return <span>{readPromise(value)}</span>;
}

function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <button events={[on("click", () => setCount((value) => value + 1))]}>
        Count {count}
      </button>
      <Suspense fallback={<span>Loading</span>}>
        <Message value={message} />
      </Suspense>
    </main>
  );
}

const container = document.getElementById("root");
if (container === null) throw new Error("Missing root.");

createRoot(container).render(<App />);
```

## Core API

- Elements: `createElement`, `Fragment`, and the JSX runtime.
- State and memoization: `useState`, `useLaggedValue`, `useMemo`, and
  `useCallback`.
- Stable identifiers: `useId()` generates IDs that match server render and
  hydration output.
- Context: `createContext(defaultValue)` plus render-time
  `readContext(context)`.
- Effects: `useReactive`, `useBeforePaint`, and `useBeforeLayout`. Effects
  receive an `AbortSignal`; attach cleanup to `signal.abort`. An empty deps
  array runs an effect once per mount.
- Strict development semantics, with no `StrictMode` component or opt-out:
  development builds render components twice per pass (discarding the first
  result) and run first-time effects and renderer `bind` callbacks twice with
  an abort in between, so impure renders and signal-ignoring cleanup surface
  early. Production builds strip these checks.
- `useExternalStore(subscribe, getSnapshot, getServerSnapshot?)` reads external
  stores. Server rendering and hydration require `getServerSnapshot`.
- `useReactiveEvent(handler)` returns a stable function for effect-held
  callbacks (subscriptions, sockets, timers). The handler always sees the
  latest committed render and follows the Fig event contract: it receives a
  trailing `AbortSignal`, and the previous invocation's signal aborts on
  re-entry and on unmount. Calls after unmount receive an already-aborted
  signal; calling it during render throws.
- `Suspense` catches pending `readPromise(promise)` reads and shows `fallback`
  until the promise settles.
- `lazy(load)` creates a component that suspends until `load()` resolves to a
  component type.
- `<Activity mode="visible" | "hidden">` hides a subtree while preserving its
  state: hiding hides the DOM (through portals) and aborts effects, binds, and
  reactive events; revealing restores the DOM and re-runs them. Trees that
  mount hidden defer their effects until first reveal, updates inside hidden
  trees prerender at idle priority, and server rendering streams hidden
  content with `display:none` so it never flashes before hydration.
- `ErrorBoundary` catches render and Fig effect errors. Use `onError` for
  reporting and change the boundary key to reset sticky fallback state.
- `transition(callback)` and `useTransition()` mark updates that may preserve
  already-revealed Suspense content while new work is pending.
- Document resources: `resources([...], children)` attaches resources to a
  subtree while rendering only `children` on the client. Resource helpers include
  `stylesheet`, `preload`, `font`, `preconnect`, `title`, `meta`, and `script`.
  Server rendering exposes `title` and `meta` as document head output; stream-safe
  assets such as stylesheets can be emitted near the segments that depend on
  them.

## Renderer APIs

Use `@bgub/fig-dom` for browser rendering:

- `createRoot(container)` renders client roots.
- `hydrateRoot(container, children, options?)` hydrates server HTML and reports
  recoverable mismatches with `onRecoverableError`.
- `createPortal(children, container, key?)` renders into external DOM targets.
- DOM events use `events={[on("click", (event, signal) => ...)]}`.
- DOM node access uses `bind={(node, signal) => ...}`.
- Raw trusted HTML uses `unsafeHTML="<p>trusted html</p>"`.

Use `@bgub/fig-server` for streaming server rendering with
`renderToReadableStream` or `renderToString`.

## License

MIT
