import {
  assets,
  createElement,
  dataResource,
  type FigNode,
  readData,
  stylesheet,
} from "@bgub/fig";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  HeadContent,
  Outlet,
  type AnyRouter,
  type RouteDataContext,
  Scripts,
} from "@bgub/fig-tanstack-router";
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server";
import { describe, expect, it } from "vitest";
import { createStartDataContext, StartData } from "./data.ts";
import { renderRouterToStream } from "./server.tsx";

describe("@bgub/fig-tanstack-start server", () => {
  it("hands route data and asset resources into the document render", async () => {
    let loads = 0;
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["start-user", id],
      load: async (id: string) => {
        loads += 1;
        return `user-${id}`;
      },
    });
    const rootRoute = createRootRouteWithContext<RouteDataContext>()({
      component: Document,
      head: () => ({
        links: [{ href: "/route.css", precedence: "route", rel: "stylesheet" }],
        meta: [
          { title: "Fig App" },
          { "script:ld+json": { name: "</script>" } },
        ],
      }),
    });
    const userRoute = createRoute({
      component: User,
      getParentRoute: () => rootRoute,
      loader: ({ context, params }) =>
        ensureRouteData(context, userResource, params.id),
      path: "users/$id",
    });
    const startData = createStartDataContext();
    const router = createRouter({
      ...startData,
      history: createMemoryHistory({ initialEntries: ["/users/42"] }),
      routeTree: rootRoute.addChildren([userRoute]),
      scrollRestoration: true,
    });

    const html = await renderRouterHtml(router, "/users/42");

    expect(html).toContain("<title data-fig-hydration-skip>Fig App</title>");
    expect(html).toContain('href="/route.css"');
    expect(html).toContain('rel="stylesheet"');
    expect(html.indexOf("<!doctype html>")).toBeLessThan(
      html.indexOf('href="/route.css"'),
    );
    expect(html).toContain('rel="stylesheet" href="/profile.css"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"name":"\\u003c/script\\u003e"');
    expect(html).toContain("<main>user-42</main>");
    expect(html).toContain(
      'data-fig-hydration-skip id="__fig_tanstack_start_data__"',
    );
    expect(html.match(/tsr-scroll-restoration-v1_3/g)).toHaveLength(1);
    expect(loads).toBe(1);
    expect(
      router.stores.getRouteMatchStore("/users/$id").get()?.loaderData,
    ).toBeUndefined();

    function User(): FigNode {
      return assets(
        stylesheet("/profile.css", { precedence: "route" }),
        createElement("main", null, readData(userResource, "42")),
      );
    }
  });

  it.each([
    { expectedLoads: 0, label: "disabled", ssr: false as const },
    { expectedLoads: 1, label: "data-only", ssr: "data-only" as const },
  ])(
    "renders a pending shell when route SSR is $label",
    async ({ expectedLoads, ssr }) => {
      let components = 0;
      let loads = 0;
      const rootRoute = createRootRouteWithContext<RouteDataContext>()({
        component: Document,
      });
      const pageRoute = createRoute({
        component: () => {
          components += 1;
          return createElement("main", null, "page");
        },
        getParentRoute: () => rootRoute,
        loader: () => {
          loads += 1;
          return "loaded";
        },
        path: "page",
        pendingComponent: () => createElement("main", null, "pending"),
        ssr,
      });
      const router = createRouter({
        ...createStartDataContext(),
        history: createMemoryHistory({ initialEntries: ["/page"] }),
        routeTree: rootRoute.addChildren([pageRoute]),
      });

      const html = await renderRouterHtml(router, "/page");

      expect(html).toContain("<main>pending</main>");
      expect(html).not.toContain("<main>page</main>");
      expect(components).toBe(0);
      expect(loads).toBe(expectedLoads);
    },
  );
});

async function renderRouterHtml(
  router: AnyRouter,
  pathname: string,
): Promise<string> {
  await router.load();
  attachRouterServerSsrUtils({ router, manifest: undefined });
  await router.serverSsr?.dehydrate();
  const result = await renderRouterToStream({
    request: new Request(`https://example.test${pathname}`),
    responseHeaders: new Headers(),
    router,
  });
  return result.response.text();
}

function Document(): FigNode {
  return createElement(
    "html",
    { lang: "en" },
    createElement("head", null, createElement(HeadContent)),
    createElement(
      "body",
      null,
      createElement(Outlet),
      createElement(StartData),
      createElement(Scripts),
    ),
  );
}
