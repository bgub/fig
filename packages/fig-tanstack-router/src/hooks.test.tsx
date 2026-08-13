// @vitest-environment happy-dom
import { createElement } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useMatch,
  useParams,
  useRouterState,
} from "./router.tsx";

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount();
  vi.restoreAllMocks();
});

describe("router hooks", () => {
  it("does not rerender a selector for unrelated router state", async () => {
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

    await act(() => router.stores.status.set("pending"));

    expect(renders).toBe(rendersBeforeUpdate);
  });

  it("honors default structural sharing for selected state", async () => {
    const stableValues: object[] = [];
    const rootRoute = createRootRoute({
      component: () => {
        const selected = useRouterState({
          select: (state) => ({
            stable: { label: "stable" },
            status: state.status,
          }),
        });
        stableValues.push(selected.stable);
        return createElement("span", null, selected.status);
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

    await act(() => router.stores.status.set("pending"));

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
      router.navigate({ params: { id: "42" }, to: "/users/$id" } as never),
    );
    expect(container.textContent).toBe("/users/42:42");
  });

  it("subscribes to narrow signal stores", async () => {
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
    const matchesSubscribe = vi.spyOn(router.stores.matches, "subscribe");
    const locationSubscribe = vi.spyOn(router.stores.location, "subscribe");
    const matchStore = router.stores.getMatchStore("/users/$id");
    const matchSubscribe = vi.spyOn(matchStore, "subscribe");
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));

    expect(container.textContent).toBe("/users/42:42");
    expect(broadSubscribe).not.toHaveBeenCalled();
    expect(matchesSubscribe).toHaveBeenCalledOnce();
    expect(locationSubscribe).toHaveBeenCalledOnce();
    expect(matchSubscribe).toHaveBeenCalledTimes(2);
  });

  it("can subscribe to an explicit router outside a provider", async () => {
    const rootRoute = createRootRoute();
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
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
