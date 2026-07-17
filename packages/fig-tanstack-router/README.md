# @bgub/fig-tanstack-router

The Fig framework adapter for TanStack Router. Route matching, loaders,
navigation, and history come from `@tanstack/router-core`; this package adds
Fig components, hooks, native links, and the reactive store bridge.

## Installation

```bash
pnpm add @bgub/fig-tanstack-router @bgub/fig @bgub/fig-dom @tanstack/router-core
```

## Usage

```tsx
import { createRoot } from "@bgub/fig-dom";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@bgub/fig-tanstack-router";

const rootRoute = createRootRoute({
  component: () => (
    <main>
      <Link to="/">Home</Link>
      <Outlet />
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Home</h1>,
});

const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/router-core" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (container === null) throw new Error("Missing root.");

createRoot(container).render(<RouterProvider router={router} />);
```

`Link` renders a native anchor. It only intercepts unmodified primary clicks;
downloads, external URLs, modifier keys, and non-`_self` targets keep their
browser behavior. Preloading supports `intent`, `render`, and `viewport`.
Pass `{ from: routeId }` to the params, search, loader-data, or route-context
hook to target an active route and infer its value from the registered tree.

This first adapter slice supports code-defined routes. File-route generation,
SSR, scroll restoration, blockers, head management, and TanStack Start are
planned follow-up layers.
