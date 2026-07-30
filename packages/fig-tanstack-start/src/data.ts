import {
  createElement,
  type FigDataStoreController,
  type FigNode,
} from "@bgub/fig";
import { HYDRATION_SKIP_ATTRIBUTE } from "@bgub/fig/internal";
import {
  type AnyRouter,
  type RouteDataContext,
  Scripts as RouterScripts,
  useRouter,
} from "@bgub/fig-tanstack-router";
import { payloadTransportMarkerId } from "./document-markers.ts";
import { createStartDataStore } from "./transport.ts";

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

export function createStartDataContext(): { context: StartDataContext } {
  return {
    context: {
      data: createStartDataStore(),
    },
  };
}

export function StartScripts(): FigNode {
  const router = useRouter<AnyRouter>();
  const routerScripts = createElement(RouterScripts);
  if (!router.isServer) return routerScripts;

  return [
    createElement("template", {
      id: payloadTransportMarkerId,
      [HYDRATION_SKIP_ATTRIBUTE]: true,
    }),
    routerScripts,
  ];
}
