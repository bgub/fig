# Fig

Fig is a small TypeScript UI runtime for building apps and metaframeworks.

It's inspired by React (components, Fiber, hydration, state, etc.), but changes some things to better match platform semantics, such as `AbortSignal` and native prop names.

It also adds simple and intuitive primitives for data (streaming and revalidation), payload components (ordinary components rendered to a stream—you refresh them through the same data APIs), and assets (CSS, fonts, images, and other dependencies declared by the components that need them). You can use these primitives directly or through a framework—the Fig integration for TanStack Start already works!

Fig would not exist without React. I have enormous respect for the React team and their work; Fig deliberately builds on their ideas, often keeps their syntax, and explores what a clean-slate implementation can do differently. Fig also takes inspiration from Remix 3.

Fig is a working alpha. The DOM renderer, streaming SSR, hydration, data resources, payload protocol, and custom-renderer API are implemented and tested. The ecosystem is still small, APIs may change before 1.0, and Fig is not a drop-in replacement for React libraries.

## Why Fig?

### Data is built in

Fig includes keyed data resources for loading, deduplication, Suspense, invalidation, refresh, cancellation, and server-to-client hydration. The API is a small renderer contract that richer data libraries can build on top of.

### A server-rendered tree should be a value

Server components are often delivered as a second application model with their own cache and refresh path. Fig's format is called **payload**, and a payload tree is just another data-resource value.

With TanStack Start, a payload resource is one declaration:

```tsx
// profile.payload.tsx
import { Isomorphic, payloadResource } from "@bgub/fig-tanstack-start/payload";
import { FollowButton } from "./follow-button.tsx";

export const profilePage = payloadResource<string>({
  key: (id: string) => ["profile-page", id],
  render: (id) => (
    <article>
      <h1>Profile {id}</h1>
      <Isomorphic component={FollowButton} profileId={id} />
    </article>
  ),
});
```

A route loads and renders it like any other data resource:

```tsx
import { readData } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { profilePage } from "../profile.payload.tsx";

export const Route = createFileRoute("/profiles/$id")({
  loader: ({ context, params }) =>
    ensureRouteData(context, profilePage, params.id),
  component: ProfileRoute,
});

function ProfileRoute() {
  const { id } = Route.useParams();
  return readData(profilePage, id);
}
```

The `render` function runs on the server and stays out of the browser bundle. `Isomorphic` marks the part that should also render and hydrate on the client; `FollowButton` itself is still an ordinary component. Refreshing the tree uses `refreshData` like any other resource.

```tsx
import { refreshData, transition } from "@bgub/fig";

transition(() => refreshData(profilePage, "42"));
```

The previous tree stays visible while the server renders and streams its replacement.

<details>
<summary>Using payload without TanStack Start</summary>

The framework adapter is built from the same public APIs. If you own the transport, render the tree into a response yourself:

```tsx
// profile-endpoint.tsx
import { clientReference } from "@bgub/fig";
import { renderToPayloadStream } from "@bgub/fig-server/payload";

const FollowButton = clientReference<{ profileId: string }>({
  id: "./follow-button.tsx#FollowButton",
});

function Profile({ id }: { id: string }) {
  return (
    <article>
      <h1>Profile {id}</h1>
      <FollowButton profileId={id} />
    </article>
  );
}

export function handleProfile(id: string): Response {
  const payload = renderToPayloadStream(<Profile id={id} />);
  return new Response(payload.stream, {
    headers: { "content-type": payload.contentType },
  });
}
```

The browser side adapts that response into an ordinary data resource:

```tsx
import { dataResource } from "@bgub/fig";
import { payloadDataLoader } from "@bgub/fig-dom";

export const profilePage = dataResource({
  key: (id: string) => ["profile-page", id],
  load: payloadDataLoader({
    request: (id, { signal }) => fetch(`/profiles/${id}`, { signal }),
    resolveClientReference: ({ id }) => {
      if (id === "./follow-button.tsx#FollowButton") {
        return import("./follow-button.tsx").then(
          (module) => module.FollowButton,
        );
      }
    },
  }),
});
```

`readData(profilePage, id)` renders the decoded tree, and `refreshData(profilePage, id)` requests a new one. The resource keeps the previous tree visible while the replacement streams in.

</details>

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
- [@bgub/fig-vite](./packages/fig-vite/README.md): Vite plugins for Fast Refresh and server data-resource transforms.
- [@bgub/fig-tanstack-router](./packages/fig-tanstack-router/README.md): TanStack Router code routes, Fig components and hooks, native links, and the private reactive-store bridge.
- [@bgub/fig-tanstack-start](./packages/fig-tanstack-start/README.md): TanStack Start server/client rendering with one Fig-owned route-data store.

DevTools remains a private workspace preview while its public contract matures.

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
- `https://fig-demo-tanstack-router.localhost`
- `https://fig-demo-tanstack-start.localhost`

Use a demo package's `dev:app` script to run the underlying server without Portless.

## Releases

Fig uses [Tegami](https://tegami.fuma-nama.dev/) to release eight public packages as one alpha-versioned group. The five renderer/core packages publish to npm and JSR; the Vite package and two TanStack adapters publish to npm. Contributor tooling requires Node.js 24.

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
