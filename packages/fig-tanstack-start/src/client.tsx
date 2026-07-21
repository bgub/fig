import { createElement } from "@bgub/fig";
import {
  type Container,
  type FigRoot,
  type FigRootOptions,
  hydrateRoot,
} from "@bgub/fig-dom";
import { RouterProvider } from "@bgub/fig-tanstack-router";
import { hydrateStart as hydrateTanStackStart } from "@tanstack/start-client-core/client";
import type { AnyRouter } from "@tanstack/router-core";
import { hydrateStartDataStore } from "./transport.ts";

export interface HydrateStartOptions extends Omit<
  FigRootOptions,
  "dataPartition" | "dataStore" | "initialData"
> {
  container?: Container;
}

export interface HydratedStart {
  root: FigRoot;
  router: AnyRouter;
}

export async function hydrateStart(
  options: HydrateStartOptions = {},
): Promise<HydratedStart> {
  const { container = document, ...rootOptions } = options;
  await waitForRouterBootstrap();
  const router = await hydrateTanStackStart();
  const dataStore = hydrateStartDataStore(router.options.context, document);

  const root = hydrateRoot(
    container,
    createElement(RouterProvider, { router }),
    { ...rootOptions, dataStore },
  );
  window.$_TSR?.h();
  return { root, router };
}

async function waitForRouterBootstrap(): Promise<void> {
  if (window.$_TSR !== undefined || document.readyState !== "loading") return;
  await new Promise<void>((resolve) =>
    document.addEventListener("DOMContentLoaded", () => resolve(), {
      once: true,
    }),
  );
}
