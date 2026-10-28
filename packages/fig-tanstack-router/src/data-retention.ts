import {
  dataResource,
  type DataResourceKey,
  type FigDataStoreHandle,
} from "@bgub/fig";
import {
  normalizeDataResourceKey,
  retainDataResource,
} from "@bgub/fig/internal";
import type { AnyRouter, LoaderFnContext } from "@tanstack/router-core";
import { dataStoreFromContext, routeDataOwners } from "./data-context.ts";

type DataOwner = {
  keys: Map<string, DataResourceKey>;
  settled: boolean;
  controller: AbortController;
};
type HydratedOwner = { id: string; keys: DataResourceKey[] };
type RouteDataHydration = { figRouteData: HydratedOwner[]; app: unknown };

type Loader = (context: LoaderFnContext) => unknown;
const wrappedLoaders = new WeakSet<Loader>();
const runRouteLoader = Symbol("fig.route-data-loader");
type LoaderContext = {
  [runRouteLoader]?: (
    args: LoaderFnContext,
    loader: Loader,
  ) => Promise<unknown>;
};

function wrap(loader: Loader): Loader {
  if (wrappedLoaders.has(loader)) return loader;
  const wrapped: Loader = (args) => {
    const run = (args.context as LoaderContext)[runRouteLoader];
    return run === undefined ? loader(args) : run(args, loader);
  };
  wrappedLoaders.add(wrapped);
  return wrapped;
}

/** Connect loader declarations to committed route matches, including SSR handoff. */
export function installRouteDataRetention(router: AnyRouter): void {
  const store = dataStoreFromContext(router.options.context);
  if (store === undefined) return;
  const owners = new WeakMap<AbortController, DataOwner>();
  let active = new Map<string, DataOwner>();
  const hydrated = new Map<string, DataOwner>();

  const retain = (
    owner: DataOwner,
    key: DataResourceKey,
    signal = owner.controller.signal,
  ) => {
    const canonical = normalizeDataResourceKey(key);
    signal.throwIfAborted();
    if (owner.keys.has(canonical)) return;
    owner.keys.set(canonical, key);
    retainKey(store, key, signal);
  };

  // Loader contexts are unique to an invocation. Keeping ownership on that
  // context allows concurrent loaders and calls after await without ambient state.
  const run: NonNullable<LoaderContext[typeof runRouteLoader]> = async (
    args,
    loader,
  ) => {
    const context = { ...args.context };
    const owner: DataOwner = {
      keys: new Map(),
      settled: false,
      controller: new AbortController(),
    };
    owners.set(args.abortController, owner);
    const signal = AbortSignal.any([
      args.abortController.signal,
      owner.controller.signal,
    ]);
    routeDataOwners.set(context, (key) => retain(owner, key, signal));
    try {
      return await loader({ ...args, context });
    } catch (error) {
      owner.controller.abort();
      throw error;
    } finally {
      owner.settled = true;
      // Preloads get the ordinary preload grace period, not active-route ownership.
      if (args.preload) owner.controller.abort();
    }
  };
  router.options.context = { ...router.options.context, [runRouteLoader]: run };

  for (const route of Object.values(router.routesById)) {
    const loader = route.options.loader;
    if (typeof loader === "function") route.options.loader = wrap(loader);
    else if (loader !== undefined) {
      route.options.loader = { ...loader, handler: wrap(loader.handler) };
    }
  }

  const reconcile = () => {
    const next = new Map<string, DataOwner>();
    for (const match of router.stores.matches.get()) {
      const source =
        owners.get(match.abortController) ?? hydrated.get(match.id);
      const existing = active.get(match.id);
      if (source === undefined || !source.settled) {
        if (existing !== undefined) next.set(match.id, existing);
        continue;
      }
      // Keys survive cached match reuse even after the loading owner's lease ends.
      const owner =
        existing?.keys === source.keys
          ? existing
          : {
              keys: source.keys,
              settled: true,
              controller: new AbortController(),
            };
      if (owner !== existing) {
        for (const key of owner.keys.values())
          retainKey(store, key, owner.controller.signal);
      }
      next.set(match.id, owner);
      source.controller.abort();
    }
    for (const [id, owner] of active) {
      if (next.get(id) !== owner) owner.controller.abort();
    }
    active = next;
  };
  let observing = false;
  const observeMatches = () => {
    // Start installs request history after constructing its server router.
    if (observing || router.stores === undefined) return;
    router.stores.matches.subscribe?.(reconcile);
    observing = true;
  };
  observeMatches();
  router.subscribe("onBeforeLoad", observeMatches);
  router.subscribe("onResolved", () => {
    reconcile();
    for (const [id, owner] of hydrated) {
      if (!active.has(id)) owner.controller.abort();
    }
  });

  const dehydrate = router.options.dehydrate;
  const hydrate = router.options.hydrate;
  router.options.dehydrate = async (): Promise<RouteDataHydration> => {
    const app = await dehydrate?.call(router.options);
    const figRouteData: HydratedOwner[] = [];
    for (const match of router.stores.matches.get()) {
      const owner = owners.get(match.abortController) ?? hydrated.get(match.id);
      if (owner !== undefined)
        figRouteData.push({ id: match.id, keys: [...owner.keys.values()] });
    }
    return { app, figRouteData };
  };
  router.options.hydrate = async (value: RouteDataHydration | undefined) => {
    observeMatches();
    for (const row of value?.figRouteData ?? []) {
      const owner: DataOwner = {
        keys: new Map(),
        settled: true,
        controller: new AbortController(),
      };
      for (const key of row.keys) retain(owner, key);
      hydrated.get(row.id)?.controller.abort();
      hydrated.set(row.id, owner);
    }
    try {
      await hydrate?.call(router.options, value?.app);
    } catch (error) {
      for (const owner of hydrated.values()) owner.controller.abort();
      hydrated.clear();
      throw error;
    }
  };
}

function retainKey(
  store: FigDataStoreHandle,
  key: DataResourceKey,
  signal: AbortSignal,
): void {
  retainDataResource(store, dataResource({ key: () => key }), [], signal);
}
