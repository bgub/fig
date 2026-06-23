import { createRequestHandler } from "@bgub/fig-start/server";
import { routes } from "./routes.ts";

// Loaded through Vite's SSR pipeline by server.mjs.
export const handler = createRequestHandler({
  clientEntry: "/src/client.tsx",
  context: () => ({}),
  dataContext: () => ({}),
  routes,
});
