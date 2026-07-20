import {
  createElement,
  type FigDataStoreController,
  type FigNode,
} from "@bgub/fig";
import { HYDRATION_SKIP_ATTRIBUTE } from "@bgub/fig/internal";
import {
  type AnyRouter,
  type RouteDataContext,
  useRouter,
} from "@bgub/fig-tanstack-router";
import { requireStartDataStore } from "./store.ts";
import {
  createStartDataStore,
  serializeStartDataStore,
  startDataScriptId,
} from "./transport.ts";

export {
  createCsrfMiddleware,
  createMiddleware,
  createServerFn,
  createStart,
} from "@tanstack/start-client-core";
export type { Register } from "@tanstack/router-core";

export interface StartDataContext extends RouteDataContext {
  data: FigDataStoreController;
}

export interface StartDataRouterOptions<TContext extends object> {
  context: TContext & StartDataContext;
}

export function createStartDataContext<TContext extends object = {}>(
  context?: TContext,
): StartDataRouterOptions<TContext> {
  return {
    context: {
      ...context,
      data: createStartDataStore(),
    } as TContext & StartDataContext,
  };
}

export function StartData(): FigNode {
  const router = useRouter<AnyRouter>();
  if (!router.isServer) return null;

  const dataStore = requireStartDataStore(router.options.context);
  return createElement("script", {
    [HYDRATION_SKIP_ATTRIBUTE]: true,
    id: startDataScriptId,
    type: "application/json",
    unsafeHTML: serializeStartDataStore(dataStore),
  });
}
