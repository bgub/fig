# Fig

Fig is a small TypeScript UI runtime for people who like React's component model but want it rebuilt around browser semantics.

It keeps JSX, function components, hooks, fibers, concurrent rendering, Suspense, transitions, and hydration. It includes keyed data resources, uses native DOM behavior where React adds an abstraction, gives every async lifetime the same cancellation protocol, and treats server-rendered component trees as ordinary values. It leaves behind legacy APIs such as class components.

Fig would not exist without React. I have enormous respect for the React team and their work; Fig deliberately builds on their ideas, often keeps their syntax, and explores what a clean-slate implementation can do differently. Fig also takes inspiration from Remix 3.

Fig is a working alpha. The DOM renderer, streaming SSR, hydration, data resources, payload protocol, and custom-renderer API are implemented and tested. The ecosystem is still small, APIs may change before 1.0, and Fig is not a drop-in replacement for React libraries.

## Why Fig?

### Data is built in

Fig includes keyed data resources for loading, deduplication, Suspense, invalidation, refresh, cancellation, and server-to-client hydration. The API is a small renderer contract that richer data libraries can build on top of.

### A server-rendered tree should be a value

Server components are often delivered as a second application model with router-owned caching and a special refresh path. Fig's server-component format is called **payload**, and a decoded payload tree is an ordinary data-resource value:

```tsx
import { dataResource, readData, refreshData, transition } from "@bgub/fig";
import { payloadDataLoader } from "@bgub/fig-dom";

const pageResource = dataResource({
  key: (id: string) => ["profile-page", id],
  load: payloadDataLoader({
    request: (id, { signal }) => fetch(`/profiles/${id}`, { signal }),
    resolveClientReference,
  }),
});

function ProfilePage({ id }: { id: string }) {
  return readData(pageResource, id);
}

transition(() => refreshData(pageResource, "42"));
```

`readData` renders the tree. `refreshData` requests a new one. The existing resource handles identity, stale content, cancellation, and Suspense, so payload does not need its own client cache or refresh protocol. Client references are explicit, the row encoding is private, and there are no `"use client"` or `"use server"` directives.

### Every lifetime should end the same way

Effects, event handlers, DOM bindings, transitions, actions, and data loaders all have lifetimes. Fig represents each one with an `AbortSignal`:

```tsx
useReactive(
  (signal) => {
    const socket = new WebSocket(`/rooms/${roomId}`);
    signal.addEventListener("abort", () => socket.close(), { once: true });
  },
  [roomId],
);
```

Effects return nothing. When their dependencies change or the component unmounts, their signal aborts. The same rule drives `bind`, events, transitions, actions, and data loaders, rather than giving each API a separate cleanup convention.

## Familiar on purpose

That familiarity is deliberate: Fig keeps React's core runtime model and diverges where a clean-slate implementation can make stronger choices.

Other differences include:

- Host behavior composes through render-time `mix` descriptors.
- Native DOM events declared as `mix={on("click", handler)}`, with native propagation and no exceptions.
- Native host prop names such as `class`, `for`, and `stroke-width`.
- DOM access through `bind={(node, signal) => ...}` instead of refs.
- Explicit `readContext`, `readPromise`, and `readData` instead of one overloaded `use(resource)`.
- Always-strict development rendering and diagnostics that throw before commit.
- TypeScript source and bundled types—no separate `@types` package.

The full divergence list lives in [docs/concepts/intentional-differences-from-react.md](./docs/concepts/intentional-differences-from-react.md).

### Bundle size

For a minimal interactive client surface, Fig is roughly half the size of React:

| Runtime      | Minified | Minified + gzip |
| ------------ | -------- | --------------- |
| Fig          | 92.5 kB  | 29.3 kB         |
| React 19.2.7 | 194.1 kB | 60.3 kB         |

Measured with esbuild 0.28.1 in production mode. The Fig entry imports `jsx`, `useState`, `createRoot`, and `on`; the React entry imports `jsx`, `useState`, and `createRoot` from `react` and `react-dom`. Fig is 52% smaller minified and 51% smaller after gzip in this comparison.

## Key Design Principles

- Small, minimal, and robust is best
- Use native platform semantics when possible
- Don't add React APIs unless they clearly strengthen Fig

## Quick start

```bash
pnpm add @bgub/fig @bgub/fig-dom
```

Configure TypeScript to use the DOM renderer's JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@bgub/fig-dom",
    "moduleResolution": "bundler"
  }
}
```

```tsx
import { useState } from "@bgub/fig";
import { createRoot, on } from "@bgub/fig-dom";

function App() {
  const [count, setCount] = useState(0);

  return (
    <button mix={on("click", () => setCount((count) => count + 1))}>
      Count: {count}
    </button>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing root.");

createRoot(root).render(<App />);
```

## Documentation

- [Introduction and API overview](./docs/1-intro-to-fig.md)
- [Fiber architecture](./docs/2-fiber-architecture.md)
- [Rendering, commit, effects, and cleanup](./docs/3-lifecycle.md)
- [Suspense, streaming, and hydration](./docs/4-async-streaming-hydration.md)
- [Data resources](./docs/5-data.md)
- [Payload](./docs/6-payload.md)
- [Asset resources](./docs/7-assets.md)
- [Subsystem contracts and rationale](./docs/concepts/README.md)

## Packages

- [@bgub/fig](./packages/fig/README.md): core elements, host mixins, hooks, context, Suspense, data resources, error boundaries, and transitions.
- [@bgub/fig-dom](./packages/fig-dom/README.md): browser rendering, hydration, delegated events, `bind`, portals, native DOM props, and payload loading.
- [@bgub/fig-server](./packages/fig-server/README.md): streaming server rendering, Suspense streaming, asset delivery, server errors, and payload rendering.
- [@bgub/fig-reconciler](./packages/fig-reconciler/README.md): renderer internals for custom host configs, including the cooperative task scheduler.
- [@bgub/fig-refresh](./packages/fig-refresh/README.md): renderer-agnostic component-family tracking for hot refresh.
- [@bgub/fig-tanstack-router](./packages/fig-tanstack-router/README.md): TanStack Router code routes, Fig components and hooks, native links, and the private reactive-store bridge.

Fig Start, the Vite integration, and DevTools are implemented as private workspace previews while their public contracts mature.

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
- `https://fig-demo-tanstack-router.localhost`

Use a demo package's `dev:app` script to run the underlying server without Portless.

## Releases

Fig uses [Tegami](https://tegami.fuma-nama.dev/) to release six public packages as one alpha-versioned group. The five renderer/core packages publish to npm and JSR; `@bgub/fig-tanstack-router` publishes to npm because its required TanStack module augmentation is not supported by JSR. Contributor tooling requires Node.js 24.

Add a changelog for a publishable change with `pnpm tegami`, or create an explicit `.tegami/<description>.md` file:

```md
---
packages:
  "@bgub/fig": minor
  "@bgub/fig-dom": patch
---

## Describe the user-visible change
```

On `main`, the publish workflow opens or updates a Version Packages pull request. Merging that pull request publishes the matching versions to their configured registries and creates one grouped GitHub release. See [docs/releases.md](./docs/releases.md) for maintainer setup and recovery.

## License

MIT
