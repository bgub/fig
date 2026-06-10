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

Deliberate divergences:

- No legacy React APIs: no class components, string refs, legacy context, or
  synthetic event pooling.
- Effects use Fig names: `useReactive`, `useBeforePaint`,
  `useBeforeLayout`, and `useOnMount`.
- Effects receive an `AbortSignal`; cleanup attaches to abort instead of being
  returned from the effect.
- DOM events use `events={[on("click", handler)]}` with native events and an
  `AbortSignal`, not `onClick` props.
- DOM node access uses `bind={(node, signal) => ...}` instead of refs.
- Host props use native DOM names such as `class`, `for`, `tabindex`,
  `stroke-width`, and `xlink:href`.
- Raw trusted HTML uses `unsafeHTML`, not `dangerouslySetInnerHTML`.
- Context reads use `readContext(context)` because context is a render input.
- Promise reads use `readPromise(promise)` rather than React's broad
  `use(resource)` API.
- Document resources use explicit `resources([...], children)` wrappers and
  small helpers such as `stylesheet`, `preload`, `font`, `preconnect`, `title`,
  `meta`, and `script`; document-mode server rendering also lowers host
  `<title>`, `<meta>`, `<link>`, and `<script>` tags into the same registry.
  Metadata is injected into `<head>` while stream-safe assets can be hoisted
  near dependent segments.

Not goals:

- Matching React's legacy or compatibility behavior.
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
  rendering, Suspense streaming, resource hoisting, server errors, and RSC
  helpers.
- [`@bgub/fig-reconciler`](./packages/fig-reconciler/README.md): renderer
  internals for custom host configs.
- [`@bgub/fig-scheduler`](./packages/fig-scheduler/README.md): cooperative
  task scheduling primitives.

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

## License

MIT
