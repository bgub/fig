import type { AnyRoute } from "./route.ts";

const serverRoutes = new WeakSet<AnyRoute>();

export function markServerRoute<T extends AnyRoute>(route: T): T {
  serverRoutes.add(route);
  return route;
}

export function isServerRoute(route: AnyRoute): boolean {
  return serverRoutes.has(route);
}
