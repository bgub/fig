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
    });

    await router.load();
    attachRouterServerSsrUtils({ router, manifest: undefined });
    await router.serverSsr?.dehydrate();
    const result = await renderRouterToStream({
      request: new Request("https://example.test/users/42"),
      responseHeaders: new Headers(),
      router,
    });
    const html = await result.response.text();

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
});

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
