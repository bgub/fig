import {
  type ClientReferenceOptions,
  clientReference,
  type ElementType,
  type FigClientReference,
  type Props,
} from "@bgub/fig";
import type { AnyRoute } from "./route.ts";

const serverRoutes = new WeakSet<AnyRoute>();
const serverClientReferences = new Map<string, ElementType>();

export function markServerRoute<T extends AnyRoute>(route: T): T {
  serverRoutes.add(route);
  return route;
}

export function isServerRoute(route: AnyRoute): boolean {
  return serverRoutes.has(route);
}

export function serverClientReference<P extends Props>(
  options: ClientReferenceOptions,
): FigClientReference<P> {
  if (options.ssr !== undefined) {
    serverClientReferences.set(options.id, options.ssr);
  }

  return clientReference<P>(options);
}

export function resolveServerClientReference(metadata: {
  id: string;
}): ElementType | undefined {
  return serverClientReferences.get(metadata.id);
}
