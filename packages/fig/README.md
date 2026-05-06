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
- State and memoization: `useState`, `useMemo`, and `useCallback`.
- Context: `createContext(defaultValue)` plus render-time
  `readContext(context)`.
- Effects: `useReactive`, `useBeforePaint`, `useBeforeLayout`, and
  `useOnMount`. Effects receive an `AbortSignal`; attach cleanup to
  `signal.abort`.
- `useExternalStore(subscribe, getSnapshot, getServerSnapshot?)` reads external
  stores. Server rendering and hydration require `getServerSnapshot`.
- `Suspense` catches pending `readPromise(promise)` reads and shows `fallback`
  until the promise settles.
- `ErrorBoundary` catches render and Fig effect errors. Use `onError` for
  reporting and change the boundary key to reset sticky fallback state.
- `transition(callback)` marks updates that may preserve already-revealed
  Suspense content while new work is pending.

## Renderer APIs

Use `@bgub/fig-dom` for browser rendering:

- `createRoot(container)` renders client roots.
- `hydrateRoot(container, children, options?)` hydrates server HTML and reports
  recoverable mismatches with `onRecoverableError`.
- `createPortal(children, container, key?)` renders into external DOM targets.
- DOM events use `events={[on("click", (event, signal) => ...)]}`.
- DOM node access uses `bind={(node, signal) => ...}`.

Use `@bgub/fig-server` for streaming server rendering with
`renderToReadableStream` or `renderToString`.

## License

MIT
