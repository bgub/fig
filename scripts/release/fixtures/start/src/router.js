import { createRouter } from "@bgub/fig-tanstack-router";
import { createStartDataContext } from "@bgub/fig-tanstack-start";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  return createRouter({
    ...createStartDataContext(),
    isServer: typeof document === "undefined",
    routeTree,
  });
}
