import { createRootRoute } from "@bgub/fig-tanstack-router";

// TanStack Start currently always generates a route manifest. The demo uses
// code-based routes at runtime, so this root supplies that build-time manifest
// until Fig's router adapter grows file-route factories.
export const Route = createRootRoute();
