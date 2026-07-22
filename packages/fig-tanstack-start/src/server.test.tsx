import {
  assets,
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
} from "@bgub/fig-tanstack-router";
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server";
import type { ServerManifest } from "@tanstack/router-core";
import { describe, expect, it } from "vitest";
import { createStartDataContext, StartScripts } from "./data.ts";
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
        links: [
          {
            crossOrigin: "use-credentials",
            href: "/route.css",
            rel: "stylesheet",
          },
        ],
        meta: [
          { title: "Fig App" },
          { "script:ld+json": { name: "</script>" } },
        ],
        scripts: [{ id: "ordered-head-script", src: "/ordered-head.js" }],
      }),
      scripts: () => [{ id: "ordered-route-script", src: "/ordered-route.js" }],
    });
    const userRoute = createRoute({
      component: User,
      getParentRoute: () => rootRoute,
      head: () => ({
        links: [
          {
            href: "/user.css",
            precedence: "route",
            rel: "stylesheet",
          },
        ],
      }),
      loader: ({ context, params }) =>
        ensureRouteData(context, userResource, params.id),
      path: "users/$id",
    });
    const startData = createStartDataContext();
    const router = createRouter({
      ...startData,
      assetCrossOrigin: "use-credentials",
      history: createMemoryHistory({ initialEntries: ["/users/42"] }),
      routeTree: rootRoute.addChildren([userRoute]),
      scrollRestoration: true,
      ssr: { nonce: "route-nonce" },
    });

    const html = await renderRouterHtml(router, "/users/42", {
      routes: {
        [rootRoute.id]: {
          css: ["/route.css"],
          preloads: ["/route.js"],
          scripts: [{ attrs: { async: true, src: "/route-async.js" } }],
        },
      },
    });

    expect(html).toContain("<title data-fig-hydration-skip>Fig App</title>");
    expect(html).toContain('href="/route.css"');
    expect(html).toContain('rel="stylesheet"');
    expect(html.match(/href="\/route\.css"/g)).toHaveLength(1);
    const routeCss = html.match(/<link[^>]*href="\/route\.css"[^>]*>/)?.[0];
    expect(routeCss).toContain('crossorigin="use-credentials"');
    expect(routeCss).toContain('nonce="route-nonce"');
    expect(html.indexOf("<!doctype html>")).toBeLessThan(
      html.indexOf('href="/route.css"'),
    );
    expect(html.indexOf('href="/route.css"')).toBeLessThan(
      html.indexOf("</head>"),
    );
    expect(html.indexOf('href="/route.css"')).toBeLessThan(
      html.indexOf("<main>user-42</main>"),
    );
    expect(html.indexOf('href="/user.css"')).toBeLessThan(
      html.indexOf("<main>user-42</main>"),
    );
    expect(html).toContain('rel="modulepreload" href="/route.js"');
    expect(html).toContain('src="/route-async.js"');
    expect(html).toContain('rel="stylesheet" href="/profile.css"');
    expect(html.match(/<link[^>]*href="\/profile\.css"[^>]*>/)?.[0]).toContain(
      'data-precedence="route"',
    );
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"name":"\\u003c/script\\u003e"');
    expect(html).toContain("<main>user-42</main>");
    expect(html.indexOf("<body>")).toBeLessThan(
      html.indexOf('id="ordered-route-script"'),
    );
    const orderedHeadScript = html.match(
      /<script[^>]*id="ordered-head-script"[^>]*><\/script>/,
    )?.[0];
    const orderedRouteScript = html.match(
      /<script[^>]*id="ordered-route-script"[^>]*><\/script>/,
    )?.[0];
    expect(orderedHeadScript).toContain('nonce="route-nonce"');
    expect(orderedHeadScript).not.toContain("data-fig-hydration-skip");
    expect(orderedRouteScript).toContain('nonce="route-nonce"');
    expect(orderedRouteScript).not.toContain("data-fig-hydration-skip");
    expect(html).toContain(
      'data-fig-hydration-skip id="__fig_tanstack_start_data__"',
    );
    expect(html).toContain(
      'id="__fig_tanstack_payloads__" data-fig-hydration-skip',
    );
    expect(html.match(/tsr-scroll-restoration-v1_3/g)).toHaveLength(1);
    expect(loads).toBe(1);
    expect(
      router.stores.getRouteMatchStore("/users/$id").get()?.loaderData,
    ).toBeUndefined();

    function User(): FigNode {
      return assets(
        [
          stylesheet("/route.css", { crossorigin: "use-credentials" }),
          stylesheet("/profile.css", { precedence: "route" }),
        ],
        <main>{readData(userResource, "42")}</main>,
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
          return <main>page</main>;
        },
        getParentRoute: () => rootRoute,
        loader: () => {
          loads += 1;
        },
        path: "page",
        pendingComponent: () => <main>pending</main>,
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
  manifest?: ServerManifest,
): Promise<string> {
  await router.load();
  attachRouterServerSsrUtils({ router, manifest });
  await router.serverSsr?.dehydrate();
  const result = await renderRouterToStream({
    request: new Request(`https://example.test${pathname}`),
    responseHeaders: new Headers(),
    router,
  });
  return result.response.text();
}

function Document(): FigNode {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <StartScripts />
      </body>
    </html>
  );
}
