// @vitest-environment happy-dom
import { createElement, type FigNode } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
  useParams,
  useRouterState,
  useSearch,
} from "./router.tsx";

type TestRouter = ReturnType<typeof makeRouter>;

declare module "@tanstack/router-core" {
  interface Register {
    router: TestRouter;
  }
}

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];
const externalUrl: string = "https://example.com/";

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("@bgub/fig-tanstack-router", () => {
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
});

function makeRouter() {
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
  });
  const routeTree = rootRoute.addChildren([homeRoute, userRoute]);
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
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
  const params = useParams({ from: "/users/$id" });
  const search = useSearch({ from: "/users/$id" });
  return createElement(
    "section",
    null,
    createElement("h1", null, `User ${params.id}`),
    createElement("p", null, `Search ${JSON.stringify(search)}`),
  );
}

async function waitForPath(
  router: ReturnType<typeof makeRouter>,
  pathname: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.stores.location.get().pathname === pathname) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Router did not navigate to ${pathname}.`);
}

async function waitForMatches(
  router: ReturnType<typeof makeRouter>,
): Promise<void> {
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
