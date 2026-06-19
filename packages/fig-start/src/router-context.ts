import { createContext, readContext, useExternalStore } from "@bgub/fig";
import type { Router, RouterState } from "./core.ts";

export const RouterContext = createContext<Router | null>(null);

export function useRouter(): Router {
  const router = readContext(RouterContext);
  if (router === null) {
    throw new Error("Router hooks must be used inside a <RouterProvider>.");
  }
  return router;
}

export function useRouterState(): RouterState {
  const router = useRouter();
  // getState works on server and client, so it doubles as the server snapshot
  // for hydration.
  const getState = () => router.getState();
  return useExternalStore(
    (onChange: () => void) => router.subscribe(onChange),
    getState,
    getState,
  );
}
