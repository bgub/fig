// @vitest-environment happy-dom
import {
  createElement,
  dataResource,
  type FigNode,
  readData,
  Suspense,
  useState,
  ViewTransition,
} from "@bgub/fig";
import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type AnyRoute,
  type AnyRouter,
  createFileRoute,
  createLazyFileRoute,
  createMemoryHistory,
  createRouteMask,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  getRouteApi,
  HeadContent,
  lazyRouteComponent,
  Link,
  linkOptions,
  type LinkProps,
  MatchRoute,
  Navigate,
  Outlet,
  redirect,
  type RouteDataContext,
  type RouteErrorComponentProps,
  RouterProvider,
  Scripts,
  useBlocker,
  useCanGoBack,
  useLocation,
  useMatch,
  useMatches,
  useMatchRoute,
  useParams,
  useRouterState,
} from "./router.tsx";

declare module "./router.tsx" {
  interface FileRoutesByPath {
    "/generated": {
      fullPath: "/generated";
      id: "/generated";
      parentRoute: AnyRoute;
      path: "/generated";
      preLoaderRoute: AnyRoute;
    };
  }
}

type TestRouter = ReturnType<typeof makeRouter>;

declare module "@tanstack/router-core" {
  interface Register {
    router: TestRouter;
  }
}

const userRouteApi = getRouteApi("/users/$id");

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];
const externalUrl: string = "https://example.com/";

afterEach(() => {
  vi.useRealTimers();
  for (const root of mountedRoots.splice(0)) root.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("@bgub/fig-tanstack-router", () => {
  it("creates generated file and lazy route records", () => {
    const route = createFileRoute("/generated")({ component: Home });
    const lazyRoute = createLazyFileRoute("/generated")({ component: User });

    expect(route.isRoot).toBe(false);
    expect(lazyRoute.options).toMatchObject({
      component: User,
      id: "/generated",
    });
  });

  it("validates reusable links and route masks without wrapping them", () => {
    const router = makeRouter();
    const reusableLink = { params: { id: "42" }, to: "/users/$id" } as const;
    const maskOptions = {
      from: "/users/$id",
      routeTree: router.routeTree,
      to: "/",
    } as const;

    expect(linkOptions(reusableLink)).toBe(reusableLink);
    expect(createRouteMask(maskOptions)).toBe(maskOptions);
  });

  it("preloads and suspends for a lazy route component once", async () => {
    let resolveModule:
      | ((module: { RouteComponent: typeof LazyContent }) => void)
      | undefined;
    const modulePromise = new Promise<{ RouteComponent: typeof LazyContent }>(
      (resolve) => {
        resolveModule = resolve;
      },
    );
    const importer = vi.fn(() => modulePromise);
    const Lazy = lazyRouteComponent(importer, "RouteComponent");
    const preload = Lazy.preload?.();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(Lazy, { label: "loaded" }),
        ),
      ),
    );

    expect(container.textContent).toBe("loading");
    await act(async () => {
      resolveModule?.({ RouteComponent: LazyContent });
      await preload;
    });

    expect(container.textContent).toBe("loaded");
    expect(importer).toHaveBeenCalledOnce();
  });

  it("renders nested code routes and reacts to router navigation", async () => {
    const router = makeRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForMatches(router));

    expect(container.querySelector("h1")?.textContent).toBe("Home at /");

    await act(() =>
      router.navigate({
        params: { id: "42" },
        search: { tab: "profile" },
        to: "/users/$id",
      }),
    );

    expect(container.querySelector("h1")?.textContent).toBe("User 42");
    expect(container.querySelector("p")?.textContent).toBe(
      'Search {"tab":"profile"}',
    );
    expect(container.querySelector("#active-user-route")?.textContent).toBe(
      "active",
    );
    expect(container.querySelector("#route-match-count")?.textContent).toBe(
      "2",
    );
    expect(router.routesById["/users/$id"].notFound().routeId).toBe(
      "/users/$id",
    );
  });

  it("merges RouterProvider options and partial context before loading", async () => {
    interface ProviderContext {
      label: string;
      preserved: string;
    }

    const rootRoute = createRootRouteWithContext<ProviderContext>()({
      component: Outlet,
    });
    const indexRoute = createRoute({
      component: () => createElement("h1", null, "provider"),
      getParentRoute: () => rootRoute,
      loader: ({ context }) => `${context.label}:${context.preserved}`,
      path: "/",
    });
    const router = createRouter({
      context: { label: "router", preserved: "kept" },
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([indexRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() =>
      root.render(
        createElement(RouterProvider, {
          context: { label: "provider" },
          defaultPreload: "render",
          router,
        }),
      ),
    );
    await act(() => waitForRouterIdle(router));

    expect(router.options.context).toEqual({
      label: "provider",
      preserved: "kept",
    });
    expect(router.options.defaultPreload).toBe("render");
    expect(router.stores.getRouteMatchStore("/").get()?.loaderData).toBe(
      "provider:kept",
    );

    await act(() =>
      root.render(
        createElement(RouterProvider, {
          context: { label: "updated" },
          router,
        }),
      ),
    );
    await act(() => router.invalidate());
    await act(() => waitForRouterIdle(router));

    expect(router.options.context).toEqual({
      label: "updated",
      preserved: "kept",
    });
    expect(router.stores.getRouteMatchStore("/").get()?.loaderData).toBe(
      "updated:kept",
    );
  });

  it("settles navigation lifecycle events after the winning transition", async () => {
    let resolveSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const slowRoute = createRoute({
      component: () => createElement("h1", null, "slow"),
      getParentRoute: () => rootRoute,
      loader: () => slow,
      path: "slow",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, slowRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));

    const events: string[] = [];
    const unsubscribe = recordNavigationLifecycle(router, events);

    const navigation = router.navigate({ to: "/slow" } as never);
    await act(() => waitForRouterLoading(router));

    expect(container.querySelector("h1")?.textContent).toBe("home");
    expect(router.stores.isTransitioning.get()).toBe(true);

    resolveSlow?.();
    await act(() => navigation);
    await act(() => waitForNavigationLifecycle(router, events));

    expect(container.querySelector("h1")?.textContent).toBe("slow");
    expect(events).toEqual(navigationLifecycle);
    expect(router.stores.status.get()).toBe("idle");
    expect(router.stores.isTransitioning.get()).toBe(false);
    expect(router.stores.resolvedLocation.get()?.pathname).toBe("/slow");

    unsubscribe();
  });

  it("settles only the latest superseding navigation", async () => {
    let slowAborted = false;
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const slowRoute = createRoute({
      component: () => createElement("h1", null, "slow"),
      getParentRoute: () => rootRoute,
      loader: ({ abortController }) =>
        new Promise<void>((resolve) => {
          abortController.signal.addEventListener(
            "abort",
            () => {
              slowAborted = true;
              resolve();
            },
            { once: true },
          );
        }),
      path: "slow",
    });
    const fastRoute = createRoute({
      component: () => createElement("h1", null, "fast"),
      getParentRoute: () => rootRoute,
      path: "fast",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, slowRoute, fastRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));

    const events: string[] = [];
    const unsubscribe = recordNavigationLifecycle(router, events);

    const slowNavigation = router.navigate({ to: "/slow" } as never);
    await act(() => waitForRouterLoading(router));
    const fastNavigation = router.navigate({ to: "/fast" } as never);
    await act(() => Promise.all([slowNavigation, fastNavigation]));
    await act(() => waitForNavigationLifecycle(router, events));

    expect(slowAborted).toBe(true);
    expect(container.querySelector("h1")?.textContent).toBe("fast");
    expect(router.stores.resolvedLocation.get()?.pathname).toBe("/fast");
    expect(events).toEqual(navigationLifecycle);

    unsubscribe();
  });

  it("replaces a noncanonical initial browser location", async () => {
    let loads = 0;
    const rootRoute = createRootRoute({ component: Outlet });
    const userRoute = createRoute({
      component: () => createElement("h1", null, "user"),
      getParentRoute: () => rootRoute,
      loader: () => {
        loads += 1;
      },
      path: "users/$id",
      validateSearch: (search): { tab?: "profile" } => ({
        tab: search.tab === "profile" ? "profile" : undefined,
      }),
    });
    const router = createRouter({
      history: createMemoryHistory({
        initialEntries: ["/users/42/?tab=invalid"],
      }),
      routeTree: rootRoute.addChildren([userRoute]),
      trailingSlash: "never",
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForHref(router, "/users/42"));
    await act(() => waitForRouterIdle(router));

    expect(router.history.location.href).toBe("/users/42");
    expect(router.stores.resolvedLocation.get()?.publicHref).toBe("/users/42");
    expect(loads).toBe(1);
  });

  it("skips hydration loads and restores router integration on unmount", async () => {
    const router = makeRouter();
    router.ssr = { manifest: undefined };
    const load = vi.spyOn(router, "load");
    const unsubscribe = vi.fn();
    vi.spyOn(router.history, "subscribe").mockReturnValue(unsubscribe);
    const previousStartTransition = router.startTransition;
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => Promise.resolve());

    expect(load).not.toHaveBeenCalled();
    expect(router.history.subscribe).toHaveBeenCalled();
    expect(router.startTransition).not.toBe(previousStartTransition);

    root.unmount();
    mountedRoots.pop();

    expect(unsubscribe).toHaveBeenCalledTimes(
      vi.mocked(router.history.subscribe).mock.calls.length,
    );
    expect(router.startTransition).toBe(previousStartTransition);
    expect(router.stores.isTransitioning.get()).toBe(false);
  });

  it("delays pending UI and preserves its minimum display duration", async () => {
    let resolveLoader: (() => void) | undefined;
    const loader = new Promise<void>((resolve) => {
      resolveLoader = resolve;
    });
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const slowRoute = createRoute({
      component: () => createElement("h1", null, "ready"),
      getParentRoute: () => rootRoute,
      loader: () => loader,
      path: "slow",
      pendingComponent: () => createElement("h1", null, "loading"),
      pendingMinMs: 100,
      pendingMs: 50,
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, slowRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));
    const realSetTimeout = globalThis.setTimeout;
    const yieldToScheduler = () =>
      new Promise<void>((resolve) => realSetTimeout(resolve, 0));
    vi.useFakeTimers();

    const navigation = router.navigate({ to: "/slow" } as never);
    await yieldToScheduler();
    expect(container.textContent).toBe("home");

    await vi.advanceTimersByTimeAsync(49);
    await yieldToScheduler();
    expect(container.textContent).toBe("home");

    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();
    await yieldToScheduler();
    expect(container.textContent).toBe("loading");

    resolveLoader?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(99);
    await yieldToScheduler();
    expect(container.textContent).toBe("loading");

    await vi.advanceTimersByTimeAsync(1);
    await navigation;
    await vi.runAllTimersAsync();
    expect(container.textContent).toBe("ready");
  });

  it.each(["route", "router default"] as const)(
    "remounts components only when %s remount dependencies change",
    async (source) => {
      let mounts = 0;
      const rootRoute = createRootRoute({ component: Outlet });
      const itemRoute = createRoute({
        component: () => {
          const [mount] = useState(() => (mounts += 1));
          return createElement("h1", null, `mount ${mount}`);
        },
        getParentRoute: () => rootRoute,
        path: "items/$id",
        remountDeps: source === "route" ? ({ params }) => params.id : undefined,
      });
      const router = createRouter({
        defaultRemountDeps:
          source === "router default"
            ? ({ params }) => ("id" in params ? params.id : undefined)
            : undefined,
        history: createMemoryHistory({ initialEntries: ["/items/1"] }),
        routeTree: rootRoute.addChildren([itemRoute]),
      });
      const container = document.createElement("div");
      const root = createRoot(container);
      mountedRoots.push(root);

      await act(() => root.render(createElement(RouterProvider, { router })));
      await act(() => waitForRouterIdle(router));
      const initialContent = container.textContent;
      const initialMounts = mounts;

      await act(() =>
        router.navigate({ params: { id: "2" }, to: "/items/$id" } as never),
      );
      expect(mounts).toBeGreaterThan(initialMounts);
      expect(container.textContent).not.toBe(initialContent);

      const remountedContent = container.textContent;
      const remountedCount = mounts;
      await act(() => router.invalidate());
      expect(mounts).toBe(remountedCount);
      expect(container.textContent).toBe(remountedContent);
    },
  );

  it("abandons redirected matches without rendering stale route content", async () => {
    let resolveRedirect: (() => void) | undefined;
    let redirectedRenders = 0;
    const redirectReady = new Promise<void>((resolve) => {
      resolveRedirect = resolve;
    });
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const redirectedRoute = createRoute({
      component: () => {
        redirectedRenders += 1;
        return createElement("h1", null, "stale");
      },
      getParentRoute: () => rootRoute,
      loader: async () => {
        await redirectReady;
        throw redirect({ to: "/target" } as never);
      },
      path: "redirected",
      pendingComponent: () => createElement("h1", null, "loading"),
      pendingMinMs: 0,
      pendingMs: 0,
    });
    const targetRoute = createRoute({
      component: () => createElement("h1", null, "target"),
      getParentRoute: () => rootRoute,
      path: "target",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([
        homeRoute,
        redirectedRoute,
        targetRoute,
      ]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));
    const navigation = router.navigate({ to: "/redirected" } as never);
    await waitForText(container, "loading");
    resolveRedirect?.();
    await navigation;
    await act(() => waitForRouterIdle(router));

    expect(container.textContent).toBe("target");
    expect(redirectedRenders).toBe(0);
  });

  it("reveals non-SSR route components after hydration", async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const clientRoute = createRoute({
      component: () => createElement("h1", null, "client"),
      getParentRoute: () => rootRoute,
      path: "/",
      pendingComponent: () => createElement("h1", null, "server"),
      ssr: false,
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([clientRoute]),
    });
    await router.load();
    router.ssr = { manifest: undefined };
    const container = document.createElement("div");
    container.innerHTML = "<h1>server</h1>";

    const root = await act(() =>
      hydrateRoot(container, createElement(RouterProvider, { router })),
    );
    mountedRoots.push(root);
    await act(() => waitForText(container, "client"));

    expect(container.textContent).toBe("client");
  });

  it("installs scroll restoration once when enabled by the provider", async () => {
    const rootRoute = createRootRoute({
      component: () => createElement("h1", null, "home"),
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    const addEventListener = vi.spyOn(document, "addEventListener");
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() =>
      root.render(
        createElement(RouterProvider, { router, scrollRestoration: true }),
      ),
    );
    await act(() => waitForRouterIdle(router));
    await act(() =>
      root.render(
        createElement(RouterProvider, { router, scrollRestoration: true }),
      ),
    );

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "scroll"),
    ).toHaveLength(1);
  });

  it("navigates after commit with the Navigate component", async () => {
    const router = makeRouter("/users/42?tab=redirect");
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForPath(router, "/"));

    expect(container.querySelector("h1")?.textContent).toBe("Home at /");
  });

  it("types route-bound hooks, links, and navigation from registration", () => {
    function checkTypes(): void {
      expectTypeOf(userRouteApi.useParams()).toEqualTypeOf<{ id: string }>();
      expectTypeOf(userRouteApi.useSearch()).toEqualTypeOf<{
        tab?: string;
      }>();
      expectTypeOf(userRouteApi.useLoaderDeps()).toEqualTypeOf<{
        tab: string;
      }>();
      expectTypeOf(
        userRouteApi.useMatch({
          select: (match) => match.id,
          structuralSharing: true,
        }),
      ).toEqualTypeOf<string>();

      const optionalMatch = useMatch({
        from: "/users/$id",
        shouldThrow: false,
      });
      if (optionalMatch !== undefined) {
        expectTypeOf(optionalMatch.params.id).toEqualTypeOf<string>();
      }
      void useParams({ shouldThrow: false, strict: false });

      const reusableLink = linkOptions({
        params: { id: "42" },
        to: "/users/$id",
      });
      userRouteApi.Link(reusableLink);

      userRouteApi.Link({ params: { id: "42" }, to: "/users/$id" });
      void userRouteApi.useNavigate()({ to: "/" });

      // @ts-expect-error The registered user route has no "missing" param.
      userRouteApi.Link({ params: { missing: "42" }, to: "/users/$id" });
    }
    void checkTypes;

    expectTypeOf<
      LinkProps["preloadIntentProximity"]
    >().toEqualTypeOf<undefined>();

    expect(userRouteApi.id).toBe("/users/$id");
  });

  it("blocks navigation with the modern resolver contract", async () => {
    let resolver: ReturnType<typeof useBlocker<AnyRouter, true>> | undefined;
    const shouldBlockFn = vi.fn(() => true);
    const rootRoute = createRootRoute({
      component: () => {
        resolver = useBlocker({ shouldBlockFn, withResolver: true });
        return createElement(
          "main",
          null,
          createElement("span", { id: "blocker-status" }, resolver.status),
          createElement(Outlet),
        );
      },
    });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => createElement("h1", null, "next"),
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));
    const blockerStatus =
      container.querySelector<HTMLElement>("#blocker-status");
    if (blockerStatus === null) throw new Error("Missing blocker status.");

    router.history.push("/next");
    await waitForText(blockerStatus, "blocked");

    expect(shouldBlockFn).toHaveBeenCalledWith({
      action: "PUSH",
      current: expect.objectContaining({ pathname: "/", routeId: "/" }),
      next: expect.objectContaining({ pathname: "/next", routeId: "/next" }),
    });
    runBlockerAction(resolver, "reset");
    await waitForText(blockerStatus, "idle");
    expect(router.history.location.pathname).toBe("/");

    router.history.push("/next");
    await waitForText(blockerStatus, "blocked");
    runBlockerAction(resolver, "proceed");
    await act(() => waitForPath(router, "/next"));
    await act(() => waitForRouterIdle(router));

    expect(router.history.location.pathname).toBe("/next");
    expect(container.querySelector("h1")?.textContent).toBe("next");
  });

  it("reacts when browser history gains and loses a back entry", async () => {
    const rootRoute = createRootRoute({
      component: () =>
        createElement(
          "main",
          null,
          createElement("span", { id: "can-go-back" }, String(useCanGoBack())),
          createElement(Outlet),
        ),
    });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => createElement("h1", null, "next"),
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));
    expect(container.querySelector("#can-go-back")?.textContent).toBe("false");

    router.history.push("/next");
    await act(() => waitForPath(router, "/next"));
    await act(() => waitForRouterIdle(router));
    expect(container.querySelector("#can-go-back")?.textContent).toBe("true");

    router.history.back();
    await act(() => waitForPath(router, "/"));
    await act(() => waitForRouterIdle(router));
    expect(container.querySelector("#can-go-back")?.textContent).toBe("false");
  });

  it("leaves document view transitions to Fig structural boundaries", async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      component: () =>
        createElement(
          ViewTransition,
          { default: "auto", name: "route-title" },
          createElement("h1", null, "home"),
        ),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () =>
        createElement(
          ViewTransition,
          { default: "auto", name: "route-title" },
          createElement("h1", null, "next"),
        ),
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    const nativeViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const finished = Promise.resolve(update()).then(() => undefined);
      return { finished, ready: Promise.resolve() };
    });
    const viewTransitionDocument = document as unknown as {
      startViewTransition: typeof nativeViewTransition | undefined;
    };
    const previousStartViewTransition =
      viewTransitionDocument.startViewTransition;
    viewTransitionDocument.startViewTransition = nativeViewTransition;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    try {
      await act(() => root.render(createElement(RouterProvider, { router })));
      await act(() => waitForRouterIdle(router));
      nativeViewTransition.mockClear();
      await act(() =>
        router.navigate({ to: "/next", viewTransition: true } as never),
      );
      await act(() => waitForRouterIdle(router));

      expect(container.querySelector("h1")?.textContent).toBe("next");
      expect(nativeViewTransition).toHaveBeenCalledOnce();
      expect(router.shouldViewTransition).toBeUndefined();
    } finally {
      viewTransitionDocument.startViewTransition = previousStartViewTransition;
    }
  });

  it("uses a native anchor and only hijacks unmodified primary clicks", async () => {
    const router = makeRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));

    const link = container.querySelector<HTMLAnchorElement>("#user-link");
    expect(link?.getAttribute("href")).toBe("/users/42?tab=profile");
    expect(link?.getAttribute("data-status")).toBeNull();
    expect(link?.getAttribute("data-link-state")).toBe("inactive");
    expect(link?.className).toBe("base inactive");
    expect(link?.textContent).toBe("inactive:idle");
    expect(link?.style.color).toBe("gray");
    expect(link?.hasAttribute("viewtransition")).toBe(false);

    const externalLink =
      container.querySelector<HTMLAnchorElement>("#external-link");
    expect(externalLink?.getAttribute("href")).toBe("https://example.com/");
    const externalClick = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    externalLink?.dispatchEvent(externalClick);
    expect(externalClick.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");

    const modifiedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    link?.dispatchEvent(modifiedClick);
    expect(modifiedClick.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");

    const click = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    await act(async () => {
      link?.dispatchEvent(click);
      await waitForPath(router, "/users/42");
    });

    expect(click.defaultPrevented).toBe(true);
    expect(container.querySelector("h1")?.textContent).toBe("User 42");
    expect(link?.getAttribute("data-status")).toBe("active");
    expect(link?.getAttribute("data-link-state")).toBe("active");
    expect(link?.className).toBe("base active");
    expect(link?.textContent).toBe("active:idle");
    expect(link?.style.color).toBe("green");
    expect(router.stores.status.get()).toBe("idle");

    const preload = vi.spyOn(router, "preloadRoute");
    container
      .querySelector<HTMLAnchorElement>("#preload-link")
      ?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(preload).toHaveBeenCalledOnce();
  });

  it("keeps link activity on the resolved route while navigation is pending", async () => {
    const router = makeRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));
    const link = container.querySelector<HTMLAnchorElement>("#user-link");
    const pending = router.buildLocation({
      params: { id: "42" },
      search: { tab: "profile" },
      to: "/users/$id",
    });

    await act(() => router.stores.location.set(pending));
    expect(link?.getAttribute("data-status")).toBeNull();

    await act(() => router.stores.resolvedLocation.set(pending));
    expect(link?.getAttribute("data-status")).toBe("active");
  });

  it("omits href and exposes native accessibility state when disabled", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <Link disabled id="disabled-link" to="/">
          Next
        </Link>
      ),
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));

    const link = container.querySelector<HTMLAnchorElement>("#disabled-link");
    expect(link?.hasAttribute("href")).toBe(false);
    expect(link?.getAttribute("aria-disabled")).toBe("true");
    expect(link?.getAttribute("role")).toBe("link");

    const click = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    link?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");
  });

  it("does not rerender a selector when unrelated router state changes", async () => {
    let renders = 0;
    const rootRoute = createRootRoute({
      component: () => {
        renders += 1;
        const pathname = useRouterState({
          select: (state) => state.location.pathname,
        });
        return createElement("span", null, pathname);
      },
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));
    const rendersBeforeUpdate = renders;

    await act(() => {
      router.stores.loadedAt.set((loadedAt) => loadedAt + 1);
    });

    expect(renders).toBe(rendersBeforeUpdate);
  });

  it("honors default structural sharing for selected router state", async () => {
    const stableValues: object[] = [];
    const rootRoute = createRootRoute({
      component: () => {
        const selected = useRouterState({
          select: (state) => ({
            loadedAt: state.loadedAt,
            stable: { label: "stable" },
          }),
        });
        stableValues.push(selected.stable);
        return createElement("span", null, String(selected.loadedAt));
      },
    });
    const router = createRouter({
      defaultStructuralSharing: true,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));
    const stableBeforeUpdate = stableValues.at(-1);

    await act(() => {
      router.stores.loadedAt.set((loadedAt) => loadedAt + 1);
    });

    expect(stableValues.at(-1)).toBe(stableBeforeUpdate);
  });

  it("selects locations and optionally reads inactive matches", async () => {
    const rootRoute = createRootRoute({
      component: () => {
        const pathname = useLocation({
          select: (location) => location.pathname,
        });
        const userMatch = useMatch({
          from: "/users/$id",
          shouldThrow: false,
        });
        return createElement(
          "span",
          { id: "selected-location" },
          `${pathname}:${userMatch?.params.id ?? "inactive"}`,
        );
      },
    });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const userRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "users/$id",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, userRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));
    expect(container.textContent).toBe("/:inactive");

    await act(() =>
      router.navigate({ params: { id: "42" }, to: "/users/$id" }),
    );
    expect(container.textContent).toBe("/users/42:42");
  });

  it("subscribes framework hooks to narrow signal stores", async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const userRoute = createRoute({
      component: () => {
        const location = useLocation();
        const params = useParams({ from: "/users/$id" });
        return createElement("span", null, `${location.pathname}:${params.id}`);
      },
      getParentRoute: () => rootRoute,
      path: "users/$id",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/users/42"] }),
      routeTree: rootRoute.addChildren([userRoute]),
    });
    await router.load();

    const broadSubscribe = vi.spyOn(router.stores.__store, "subscribe");
    const firstMatchSubscribe = vi.spyOn(router.stores.firstId, "subscribe");
    const locationSubscribe = vi.spyOn(router.stores.location, "subscribe");
    const matchSubscribe = vi.spyOn(
      router.stores.getRouteMatchStore("/users/$id"),
      "subscribe",
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));

    expect(container.textContent).toBe("/users/42:42");
    expect(broadSubscribe).not.toHaveBeenCalled();
    expect(firstMatchSubscribe).toHaveBeenCalledOnce();
    expect(locationSubscribe).toHaveBeenCalledOnce();
    expect(matchSubscribe).toHaveBeenCalledOnce();
  });

  it("can subscribe to an explicit router outside a provider", async () => {
    const router = makeRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() =>
      root.render(
        createElement(() => {
          const pathname = useRouterState({
            router,
            select: (state) => state.location.pathname,
          });
          return createElement("span", null, pathname);
        }),
      ),
    );

    expect(container.textContent).toBe("/");
  });

  it("renders a global not-found inside the root outlet", async () => {
    const rootRoute = createRootRoute({
      component: () =>
        createElement("main", { id: "root-shell" }, createElement(Outlet)),
      notFoundComponent: () =>
        createElement("h1", { id: "global-not-found" }, "Not found"),
    });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/missing"] }),
      routeTree: rootRoute.addChildren([homeRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));

    expect(container.querySelector("#root-shell")).not.toBeNull();
    expect(container.querySelector("#global-not-found")?.textContent).toBe(
      "Not found",
    );
  });

  it("reports and invalidates attributed data errors before reset", async () => {
    let loads = 0;
    let resetRoute: (() => void) | undefined;
    const onCatch = vi.fn();
    const resource = dataResource<[], string>({
      key: () => ["route-reset"],
      load: async () => {
        loads += 1;
        if (loads === 1) throw new Error("failed once");
        return "recovered";
      },
    });
    const rootRoute = createRootRouteWithContext<RouteDataContext>()({});
    const route = createRoute({
      component: () => createElement("h1", null, readData(resource)),
      errorComponent: ({ error, reset }: RouteErrorComponentProps) => {
        resetRoute = reset;
        return createElement(
          "p",
          { id: "route-error" },
          error instanceof Error ? error.message : "unknown",
        );
      },
      getParentRoute: () => rootRoute,
      loader: ({ context }) => ensureRouteData(context, resource),
      path: "/",
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);
    const router = createRouter({
      context: { data: root.data },
      defaultOnCatch: onCatch,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([route]),
    });

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForMatches(router));

    expect(container.querySelector("#route-error")?.textContent).toBe(
      "failed once",
    );
    expect(onCatch).toHaveBeenCalledOnce();
    expect(onCatch.mock.calls[0]?.[1]).toMatchObject({
      componentStack: expect.any(String),
    });
    expect(loads).toBe(1);

    await act(() => resetRoute?.());
    expect(loads).toBe(2);
    await act(() => waitForText(container, "recovered"));

    expect(container.textContent).toBe("recovered");
  });

  it("delegates route data to the fig data store as the external cache", async () => {
    let loads = 0;
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["tsr-user", id],
      load: async (id: string) => {
        loads += 1;
        return `user-${id} v${loads}`;
      },
    });

    function UserData(): FigNode {
      const params = useParams() as { id: string };
      return createElement(
        "h2",
        { id: "user-data" },
        readData(userResource, params.id),
      );
    }

    const rootRoute = createRootRouteWithContext<RouteDataContext>()({});
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const userRoute = createRoute({
      component: UserData,
      getParentRoute: () => rootRoute,
      loader: ({ context, params }) =>
        ensureRouteData(context, userResource, params.id),
      path: "users/$id",
    });
    const routeTree = rootRoute.addChildren([homeRoute, userRoute]);

    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    // root.data is a lazy handle, so it can enter router context before the
    // first render. Its presence makes the adapter disable the router's own
    // preload SWR cache: every load event reaches the route-data helper, which
    // delegates to the store.
    const router = createRouter({
      context: { data: root.data },
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree,
    });
    expect(router.options.defaultPreloadStaleTime).toBe(0);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForMatches(router));

    await act(() => router.navigate({ params: { id: "7" }, to: "/users/$id" }));

    // The loader's ensureData and the component's readData share one entry.
    expect(container.querySelector("#user-data")?.textContent).toBe(
      "user-7 v1",
    );
    expect(loads).toBe(1);
    expect(
      router.stores.getRouteMatchStore("/users/$id").get()?.loaderData,
    ).toBeUndefined();

    // Freshness lives in the store: invalidating the resource re-renders the
    // subscribed route component with the revalidated value, no router
    // invalidation involved.
    await act(() => root.data.invalidateData(userResource, "7"));
    expect(container.querySelector("#user-data")?.textContent).toBe(
      "user-7 v2",
    );
    expect(loads).toBe(2);

    // Re-navigation re-runs the loader (staleTime 0), which hits the cache.
    await act(() => router.navigate({ to: "/" }));
    await act(() => router.navigate({ params: { id: "7" }, to: "/users/$id" }));
    expect(container.querySelector("#user-data")?.textContent).toBe(
      "user-7 v2",
    );
    expect(loads).toBe(2);
  });

  it("rejects loader return values in dev when the fig store is the cache", async () => {
    const rootRoute = createRootRouteWithContext<RouteDataContext>()({
      errorComponent: ({ error }: RouteErrorComponentProps) =>
        createElement(
          "p",
          { id: "loader-data-error" },
          error instanceof Error ? error.message : "unknown",
        ),
    });
    const route = createRoute({
      component: () => createElement("h1", null, "leaked"),
      getParentRoute: () => rootRoute,
      loader: () => "navigation-scoped value",
      path: "/",
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);
    const router = createRouter({
      context: { data: root.data },
      defaultOnCatch: () => undefined,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([route]),
    });

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForMatches(router));

    expect(
      container.querySelector("#loader-data-error")?.textContent,
    ).toContain("loader returned a value while router.context.data");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("owns route assets per match while keeping synchronous scripts positioned", async () => {
    const rootRoute = createRootRoute({ component: AssetDocument });
    const homeRoute = createRoute({
      component: () => createElement("h1", null, "home"),
      getParentRoute: () => rootRoute,
      head: () => ({
        links: [
          {
            href: "data:text/css,/*router-home*/",
            precedence: "route",
            rel: "stylesheet",
          },
        ],
        meta: [
          { title: "Home assets" },
          { content: "home", name: "description" },
        ],
        scripts: [{ id: "home-ordered", src: "/router-home-ordered.js" }],
      }),
      path: "/",
    });
    const awayRoute = createRoute({
      component: () => createElement("h1", null, "away"),
      getParentRoute: () => rootRoute,
      head: () => ({
        links: [
          {
            href: "data:text/css,/*router-away*/",
            precedence: "route",
            rel: "stylesheet",
          },
        ],
        meta: [
          { title: "Away assets" },
          { content: "away", name: "description" },
        ],
        scripts: [{ id: "away-ordered", src: "/router-away-ordered.js" }],
      }),
      path: "away",
    });
    const bareRoute = createRoute({
      component: () => createElement("h1", null, "bare"),
      getParentRoute: () => rootRoute,
      path: "bare",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, awayRoute, bareRoute]),
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForRouterIdle(router));

    expect(document.title).toBe("Home assets");
    expect(
      document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe("home");
    expect(
      document.head.querySelectorAll(
        'link[href="data:text/css,/*router-home*/"]',
      ),
    ).toHaveLength(1);
    expect(container.querySelector("#home-ordered")?.parentElement).toBe(
      container.firstElementChild,
    );

    await act(() => router.navigate({ to: "/away" } as never));

    expect(document.title).toBe("Away assets");
    expect(
      document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe("away");
    expect(
      document.head.querySelectorAll(
        'link[href="data:text/css,/*router-away*/"]',
      ),
    ).toHaveLength(1);
    expect(container.querySelector("#home-ordered")).toBeNull();
    expect(container.querySelector("#away-ordered")).not.toBeNull();

    await act(() => router.navigate({ to: "/bare" } as never));

    expect(document.title).toBe("");
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(container.querySelector("#away-ordered")).toBeNull();

    for (const asset of document.head.querySelectorAll(
      '[href^="data:text/css,/*router-"], [src^="/router-"]',
    )) {
      asset.remove();
    }
  });
});

function AssetDocument(): FigNode {
  return createElement(
    "div",
    null,
    createElement(HeadContent, {}),
    createElement(Outlet),
    createElement(Scripts),
  );
}

function makeRouter(initialEntry = "/") {
  const rootRoute = createRootRoute({ component: Layout });
  const homeRoute = createRoute({
    component: Home,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const userRoute = createRoute({
    component: User,
    getParentRoute: () => rootRoute,
    path: "users/$id",
    validateSearch: (search): { tab?: string } => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
    }),
    loaderDeps: ({ search }) => ({ tab: search.tab ?? "overview" }),
    loader: ({ deps }) => `loader:${deps.tab}`,
  });
  const routeTree = rootRoute.addChildren([homeRoute, userRoute]);
  return createRouter({
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    routeTree,
  });
}

function Layout(): FigNode {
  const status = useRouterState({ select: (state) => state.status });
  return (
    <main data-router-status={status}>
      <Link
        activeProps={{
          class: "active",
          "data-link-state": "active",
          style: { color: "green" },
        }}
        class="base"
        id="user-link"
        inactiveProps={() => ({
          class: "inactive",
          "data-link-state": "inactive",
          style: { color: "gray" },
        })}
        params={{ id: "42" }}
        search={{ tab: "profile" }}
        to="/users/$id"
        viewTransition
      >
        {({ isActive, isTransitioning }) =>
          `${isActive ? "active" : "inactive"}:${
            isTransitioning ? "transitioning" : "idle"
          }`
        }
      </Link>
      <Link
        id="preload-link"
        params={{ id: "7" }}
        preload="intent"
        preloadDelay={0}
        to="/users/$id"
      >
        Preload user
      </Link>
      <Link id="external-link" to={externalUrl}>
        External
      </Link>
      <Outlet />
    </main>
  );
}

function Home(): FigNode {
  const location = useLocation();
  return createElement("h1", null, `Home at ${location.pathname}`);
}

function User(): FigNode {
  const params = userRouteApi.useParams();
  const search = userRouteApi.useSearch();
  const loaderDeps = userRouteApi.useLoaderDeps();
  const routeId = userRouteApi.useMatch({ select: (match) => match.id });
  const matchCount = useMatches({ select: (matches) => matches.length });
  const matchRoute = useMatchRoute();
  const matched = matchRoute({ params, to: "/users/$id" });

  if (search.tab === "redirect") return <Navigate to="/" />;

  return createElement(
    "section",
    {
      "data-loader-tab": loaderDeps.tab,
      "data-route-id": routeId,
      "data-route-matched": String(matched !== false),
    },
    createElement("h1", null, `User ${params.id}`),
    createElement("p", null, `Search ${JSON.stringify(search)}`),
    createElement("span", { id: "route-match-count" }, String(matchCount)),
    createElement(
      MatchRoute,
      { params, to: "/users/$id" },
      createElement("span", { id: "active-user-route" }, "active"),
    ),
    createElement(userRouteApi.Link, { to: "/" }, "Home"),
  );
}

function LazyContent({ label }: { label: string }): FigNode {
  return createElement("span", null, label);
}

const navigationLifecycle = [
  "onLoad",
  "onBeforeRouteMount",
  "onResolved",
  "onRendered",
] as const;

function recordNavigationLifecycle(
  router: AnyRouter,
  events: string[],
): () => void {
  const unsubscribes = navigationLifecycle.map((type) =>
    router.subscribe(type, (event) => events.push(event.type)),
  );
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

async function waitForPath(router: AnyRouter, pathname: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.stores.location.get().pathname === pathname) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Router did not navigate to ${pathname}.`);
}

async function waitForHref(router: AnyRouter, href: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.latestLocation.publicHref === href) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Router did not navigate to ${href}.`);
}

async function waitForMatches(router: AnyRouter): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      router.stores.matchesId.get().length > 0 &&
      !router.stores.isLoading.get()
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Router did not load its initial matches.");
}

async function waitForRouterLoading(router: AnyRouter): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.stores.isLoading.get()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Router did not start loading.");
}

async function waitForRouterIdle(router: AnyRouter): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      router.stores.matchesId.get().length > 0 &&
      !router.stores.isLoading.get() &&
      !router.stores.isTransitioning.get() &&
      router.stores.status.get() === "idle" &&
      router.stores.resolvedLocation.get()?.href ===
        router.stores.location.get().href
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Router did not settle: ${JSON.stringify({
      isLoading: router.stores.isLoading.get(),
      isTransitioning: router.stores.isTransitioning.get(),
      location: router.stores.location.get().href,
      matches: router.stores.matchesId.get(),
      resolvedLocation: router.stores.resolvedLocation.get()?.href,
      status: router.stores.status.get(),
    })}`,
  );
}

async function waitForNavigationLifecycle(
  router: AnyRouter,
  events: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (events.length >= navigationLifecycle.length) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Router emitted ${events.length} of ${navigationLifecycle.length} events: ${JSON.stringify(
      {
        events,
        isLoading: router.stores.isLoading.get(),
        isTransitioning: router.stores.isTransitioning.get(),
        resolvedLocation: router.stores.resolvedLocation.get()?.href,
        status: router.stores.status.get(),
      },
    )}`,
  );
}

async function waitForText(
  container: HTMLElement,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (container.textContent === text) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Container did not render ${JSON.stringify(text)}; received ${JSON.stringify(container.textContent)}.`,
  );
}

function runBlockerAction(
  resolver: ReturnType<typeof useBlocker<AnyRouter, true>> | undefined,
  action: "proceed" | "reset",
): void {
  if (resolver?.status !== "blocked") {
    throw new Error(`Cannot ${action} an idle blocker.`);
  }
  resolver[action]();
}
