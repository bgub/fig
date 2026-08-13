// @vitest-environment happy-dom
import { createElement, type FigNode } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  Outlet,
  RouterProvider,
  Scripts,
} from "./router.tsx";

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

describe("router document assets", () => {
  it("owns assets per match while keeping synchronous scripts positioned", async () => {
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
  });

  it("snapshots an inline CSS manifest once per server render", async () => {
    const rootRoute = createRootRoute({ component: AssetDocument });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      isServer: true,
      routeTree: rootRoute,
    });
    await router.load();
    attachRouterServerSsrUtils({
      router,
      manifest: {
        inlineCss: { styles: { "/root.css": "body{}" } },
        routes: {
          [rootRoute.id]: {
            css: ["/root.css"],
            preloads: ["/root.js"],
          },
        },
      },
    });
    const serverSsr = router.ssr;
    if (serverSsr === undefined) throw new Error("Missing server SSR state.");
    const readManifest = vi.spyOn(serverSsr, "manifest", "get");
    let providerRenders = 0;
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    function App() {
      providerRenders += 1;
      return createElement(RouterProvider, { router });
    }

    await act(() => root.render(createElement(App)));

    expect(readManifest).toHaveBeenCalledTimes(providerRenders);
    router.serverSsr?.cleanup();
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

async function waitForRouterIdle(router: AnyRouter): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      router.stores.ids.get().length > 0 &&
      router.stores.status.get() === "idle" &&
      router.stores.resolvedLocation.get()?.href ===
        router.stores.location.get().href
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Router did not settle.");
}
