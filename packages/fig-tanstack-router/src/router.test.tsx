// @vitest-environment happy-dom
import {
  createElement,
  dataResource,
  type FigNode,
  readData,
  Suspense,
} from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type AnyRoute,
  type AnyRouter,
  createFileRoute,
  createLazyFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  getRouteApi,
  lazyRouteComponent,
  Link,
  MatchRoute,
  Navigate,
  Outlet,
  type RouteDataContext,
  type RouteErrorComponentProps,
  RouterProvider,
  useLocation,
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
    resolveModule?.({ RouteComponent: LazyContent });
    await preload;
    await act(() => waitForText(container, "loaded"));

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
      expectTypeOf(userRouteApi.useLoaderData()).toEqualTypeOf<string>();
      expectTypeOf(
        userRouteApi.useMatch({ select: (match) => match.id }),
      ).toEqualTypeOf<string>();

      userRouteApi.Link({ params: { id: "42" }, to: "/users/$id" });
      void userRouteApi.useNavigate()({ to: "/" });

      // @ts-expect-error The registered user route has no "missing" param.
      userRouteApi.Link({ params: { missing: "42" }, to: "/users/$id" });
    }
    void checkTypes;

    expect(userRouteApi.id).toBe("/users/$id");
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

  it("invalidates attributed data errors before resetting a route", async () => {
    let loads = 0;
    let resetRoute: (() => void) | undefined;
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
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([route]),
    });

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForMatches(router));

    expect(container.querySelector("#route-error")?.textContent).toBe(
      "failed once",
    );
    expect(loads).toBe(1);

    await act(() => resetRoute?.());
    await act(() => waitForText(container, "recovered"));

    expect(container.textContent).toBe("recovered");
    expect(loads).toBe(2);
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
});

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
        id="user-link"
        params={{ id: "42" }}
        search={{ tab: "profile" }}
        to="/users/$id"
        viewTransition
      >
        User
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
  const loaderData = userRouteApi.useLoaderData();
  const routeId = userRouteApi.useMatch({ select: (match) => match.id });
  const matchCount = useMatches({ select: (matches) => matches.length });
  const matchRoute = useMatchRoute();
  const matched = matchRoute({ params, to: "/users/$id" });

  if (search.tab === "redirect") return <Navigate to="/" />;

  return createElement(
    "section",
    {
      "data-loader-data": loaderData,
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

async function waitForPath(router: AnyRouter, pathname: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.stores.location.get().pathname === pathname) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Router did not navigate to ${pathname}.`);
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

async function waitForText(
  container: HTMLElement,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (container.textContent === text) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Container did not render ${JSON.stringify(text)}.`);
}
