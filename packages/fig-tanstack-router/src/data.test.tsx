// @vitest-environment happy-dom
import { createElement, dataResource, type FigNode, readData } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  type RouteDataContext,
  type RouteErrorComponentProps,
  RouterProvider,
  useParams,
} from "./router.tsx";

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount();
  vi.restoreAllMocks();
});

describe("route data", () => {
  it("invalidates attributed data errors before resetting a route", async () => {
    let loads = 0;
    let resetRoute: (() => void) | undefined;
    const onCatch = vi.fn();
    const resource = dataResource<[], string>({
      key: () => ["route-reset"],
      load: async () => {
        loads += 1;
        if (loads < 3) throw new Error(`failed ${loads}`);
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
      "failed 1",
    );
    expect(onCatch).toHaveBeenCalledOnce();
    expect(onCatch.mock.calls[0]?.[1]).toMatchObject({
      componentStack: expect.any(String),
    });
    expect(loads).toBe(1);

    await act(() => resetRoute?.());
    expect(loads).toBe(2);
    await act(() => waitForText(container, "failed 2"));

    await act(() => resetRoute?.());
    expect(loads).toBe(3);
    await act(() => waitForText(container, "recovered"));

    expect(container.textContent).toBe("recovered");
  });

  it("uses the Fig data store as the external route cache", async () => {
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
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);
    const router = createRouter({
      context: { data: root.data },
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, userRoute]),
    });
    expect(router.options.defaultPreloadStaleTime).toBe(0);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => waitForMatches(router));
    await act(() =>
      router.navigate({ params: { id: "7" }, to: "/users/$id" } as never),
    );

    expect(container.querySelector("#user-data")?.textContent).toBe(
      "user-7 v1",
    );
    expect(loads).toBe(1);
    expect(
      router.stores.getMatchStore("/users/$id").get()?.loaderData,
    ).toBeUndefined();

    await act(() => root.data.invalidateData(userResource, "7"));
    expect(container.querySelector("#user-data")?.textContent).toBe(
      "user-7 v2",
    );
    expect(loads).toBe(2);

    await act(() => router.navigate({ to: "/" } as never));
    await act(() =>
      router.navigate({ params: { id: "7" }, to: "/users/$id" } as never),
    );
    expect(container.querySelector("#user-data")?.textContent).toBe(
      "user-7 v2",
    );
    expect(loads).toBe(2);
  });

  it("rejects loader return values when the Fig store is the cache", async () => {
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
});

async function waitForMatches(router: AnyRouter) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.stores.ids.get().length > 0 && !router.state.isLoading) return;
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
  throw new Error(
    `Container did not render ${JSON.stringify(text)}; received ${JSON.stringify(container.textContent)}.`,
  );
}
