# Fig

Fig is a TypeScript UI runtime inspired by React. It explores the same ideas, but drops legacy features like class components, changes up APIs to "use the platform" more (e.g. passing AbortControllers instead of returning cleanup functions, using native instead of synthetic events) and adds a few new features.

I love React and I have huge respect for the React team. I think they're brilliant and made pretty much all the right choices. This project is directly inspired by their ideas, often copies syntax, and wouldn't exist without them! Fig also takes some inspiration from Remix 3.

Similarities to React: fiber/concurrency, Suspense, Context (with lazy propagation), transitions, `Activity`, etc.

Differences from React (highlights):

- 55% smaller bundle size
- Written in TypeScript, not Flow (no need to install `@types` packages)
- First-class support for data: loading, streaming from the server, and invalidating
- DOM events are native, declared as `events={[on("click", handler)]}`
  - Propagation is native with no exceptions
- DOM access uses `bind={(node, signal) => ...}` instead of references
- Effects, events, binds, transitions, actions, and data loaders all receive an `AbortSignal`; nothing returns a cleanup function.
- `class` instead of `className`
- Host props use native names (`class`, `for`, `stroke-width`)
- React's `use(resource)` splits into `readContext`, `readPromise`, and `readData`
- Fig has its own server-component wire format, called payload

The full divergence list lives in [docs/concepts/intentional-differences-from-react.md](./docs/concepts/intentional-differences-from-react.md);

## Key Design Principles

- Small, minimal, and robust is best
- Use native platform semantics when possible
- Don't add React APIs unless they clearly strengthen Fig

## Packages

- [@bgub/fig](./packages/fig/README.md): core elements, hooks, context, Suspense, error boundaries, and transitions.
- [@bgub/fig-dom](./packages/fig-dom/README.md): browser rendering, hydration, delegated events, `bind`, portals, native DOM props, and `unsafeHTML`.
- [@bgub/fig-server](./packages/fig-server/README.md): streaming server rendering, Suspense streaming, resource hoisting, server errors, and the server-component payload helpers.
- [@bgub/fig-reconciler](./packages/fig-reconciler/README.md): renderer internals for custom host configs, including the cooperative task scheduler.

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
      <button events={[on("click", () => setCount((v) => v + 1))]}>
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

Demo apps live in [apps/](./apps).

```bash
pnpm dev
```

`pnpm dev` opens Turborepo's task TUI. Its task graph builds each prerequisite once, then starts the long-running package builders and demo servers as separate tasks. Vite provides browser HMR; the bundled server demos rebuild with tsdown and restart automatically.

The demo sites run through Portless:

- `https://fig-demo-client.localhost`
- `https://fig-demo-ssr.localhost`
- `https://fig-demo-payload.localhost`
- `https://fig-demo-start.localhost`

Use a demo package's `dev:app` script to run the underlying server without Portless.

## Releases

Fig uses [Tegami](https://tegami.fuma-nama.dev/) to release the five public packages as one alpha-versioned group to npm and JSR. Contributor tooling requires Node.js 24.

Add a changelog for a publishable change with `pnpm tegami`, or create an explicit `.tegami/<description>.md` file:

```md
---
packages:
  "@bgub/fig": minor
  "@bgub/fig-dom": patch
---

## Describe the user-visible change
```

On `main`, the publish workflow opens or updates a Version Packages pull request. Merging that pull request publishes the matching versions to both registries and creates one grouped GitHub release. See [docs/releases.md](./docs/releases.md) for maintainer setup and recovery.

## License

MIT
