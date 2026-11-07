// @vitest-environment happy-dom
import { dataResource, readData, useId } from "@bgub/fig";
import { hydrateRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { renderToHtml } from "@bgub/fig-server";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  Link,
  Outlet,
  RouterProvider,
  type RouteDataContext,
} from "@bgub/fig-tanstack-router";
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server";
import { afterEach, describe, expect, it } from "vitest";
import { createStartDataContext, StartScripts } from "./data.ts";
import { renderRouterToStream } from "./server.tsx";

const roots: Array<ReturnType<typeof hydrateRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("TanStack Start data round trip", () => {
  it("keeps nested Link useId paths stable during hydration", async () => {
    function LinkContent() {
      const id = useId();
      return <span id={id}>{id}</span>;
    }

    function LinkApp() {
      return (
        <Link to="/">
          <LinkContent />
        </Link>
      );
    }

    const createTestRouter = (isServer: boolean) => {
      const rootRoute = createRootRouteWithContext<RouteDataContext>()({
        component: LinkApp,
      });
      return createRouter({
        ...createStartDataContext(),
        history: createMemoryHistory({ initialEntries: ["/"] }),
        isServer,
        routeTree: rootRoute,
      });
    };
    const serverRouter = createTestRouter(true);
    await serverRouter.load();
    attachRouterServerSsrUtils({ manifest: undefined, router: serverRouter });
    await serverRouter.serverSsr?.dehydrate();
    const html = await renderToHtml(<RouterProvider router={serverRouter} />);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const serverId = container.querySelector("span")?.id;
    if (serverId === undefined) throw new Error("Missing server link content.");
    const recoverableErrors: unknown[] = [];
    const clientRouter = createTestRouter(false);
    clientRouter.ssr = { manifest: undefined };
    await clientRouter.load();

    const root = await act(() =>
      hydrateRoot(container, <RouterProvider router={clientRouter} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      }),
    );
    roots.push(root);

    expect(recoverableErrors).toEqual([]);
    const hydratedId = container.querySelector("span")?.id;
    if (hydratedId === undefined)
      throw new Error("Missing hydrated link content.");
    expect(hydratedId).toBe(serverId);
  });

  it("hydrates route-loader data without refetching", () =>
    runDataRoundTrip(true));

  it("hydrates render-discovered data without refetching", () =>
    runDataRoundTrip(false));

  it("streams the shell's opted-in dependencies after the router bootstrap", async () => {
    let networkLoads = 0;
    const source = dataResource<[], string[], string[]>({
      key: () => ["round-trip-source"],
      transfer: (value) => value,
      load: ({ transferred }) => {
        if (transferred !== undefined) return transferred;
        networkLoads += 1;
        return ["a", "b"];
      },
    });
    const derived = dataResource<[], string>({
      key: () => ["round-trip-derived"],
      load: async ({ data }) => (await data.ensureData(source)).join(","),
    });

    function Derived() {
      return <span>{readData(derived)}</span>;
    }

    function Document() {
      return (
        <html lang="en">
          <head />
          <body>
            <div id="app">
              <Derived />
            </div>
            <StartScripts />
          </body>
        </html>
      );
    }

    const serverRouter = createRouter({
      ...createStartDataContext(),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      isServer: true,
      routeTree: createRootRouteWithContext<RouteDataContext>()({
        component: Document,
      }),
    });
    await serverRouter.load();
    attachRouterServerSsrUtils({ router: serverRouter, manifest: undefined });
    await serverRouter.serverSsr?.dehydrate();
    const result = await renderRouterToStream({
      request: new Request("https://example.test/"),
      responseHeaders: new Headers(),
      router: serverRouter,
    });
    const html = await result.response.text();
    networkLoads = 0;

    // A marker for the source leads the document; the snapshot holds the
    // read's row, and the source's form follows the router bootstrap.
    const bootstrap = html.indexOf("$_TSR");
    const marker = html.indexOf('{"key":["round-trip-source"],"pending":true}');
    const form = html.indexOf('{"key":["round-trip-source"],"value":');
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf('"key":["round-trip-derived"]')).toBeLessThan(
      bootstrap,
    );
    expect(form).toBeGreaterThan(bootstrap);

    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    const clientData = createStartDataContext();

    // Run the streamed data operations, as the parser would, then hydrate.
    for (const script of parsed.querySelectorAll("script:not([type])")) {
      if (script.textContent?.includes("__figSSR")) {
        // happy-dom does not run inserted scripts; evaluate the server's own
        // trusted operation scripts directly.
        // oxlint-disable-next-line typescript/no-implied-eval
        new Function(script.textContent)();
      }
    }
    const container = document.querySelector("#app");
    if (container === null) throw new Error("Missing server-rendered app.");
    const root = await act(() =>
      hydrateRoot(container, <Derived />, {
        dataStore: clientData.context.data,
      }),
    );
    roots.push(root);

    expect(container.textContent).toBe("a,b");
    // The source comes from its streamed form, not the network.
    expect(await clientData.context.data.ensureData(source)).toEqual([
      "a",
      "b",
    ]);
    expect(networkLoads).toBe(0);
  });

  async function runDataRoundTrip(preloadFromRoute: boolean) {
    let loads = 0;
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["round-trip-user", id],
      load: async (id: string) => {
        loads += 1;
        return `user-${id}-v${loads}`;
      },
    });

    function User() {
      return <span id="user">{readData(userResource, "42")}</span>;
    }

    function Document() {
      return (
        <html lang="en">
          <head />
          <body>
            <div id="app">
              <Outlet />
            </div>
            <StartScripts />
          </body>
        </html>
      );
    }

    const serverRootRoute = createRootRouteWithContext<RouteDataContext>()({
      component: Document,
    });
    const serverUserRoute = createRoute({
      component: User,
      getParentRoute: () => serverRootRoute,
      loader: preloadFromRoute
        ? ({ context }) => ensureRouteData(context, userResource, "42")
        : undefined,
      path: "users/$id",
    });
    const serverData = createStartDataContext();
    const serverRouter = createRouter({
      context: serverData.context,
      history: createMemoryHistory({ initialEntries: ["/users/42"] }),
      isServer: true,
      routeTree: serverRootRoute.addChildren([serverUserRoute]),
    });

    await serverRouter.load();
    expect(loads).toBe(preloadFromRoute ? 1 : 0);
    attachRouterServerSsrUtils({ router: serverRouter, manifest: undefined });
    await serverRouter.serverSsr?.dehydrate();
    const result = await renderRouterToStream({
      request: new Request("https://example.test/users/42"),
      responseHeaders: new Headers(),
      router: serverRouter,
    });
    const html = await result.response.text();

    expect(html).toContain("user-42-v1");
    expect(loads).toBe(1);

    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    expect(
      document.querySelector('script[type="application/json"]'),
    ).not.toBeNull();

    const clientData = createStartDataContext();
    expect(clientData.context.data.snapshot()).toHaveLength(1);

    const container = document.querySelector("#app");
    if (container === null)
      throw new Error("Missing server-rendered app root.");
    const root = await act(() =>
      hydrateRoot(container, <User />, {
        dataStore: clientData.context.data,
      }),
    );
    roots.push(root);

    expect(container.textContent).toBe("user-42-v1");
    expect(loads).toBe(1);

    await act(() => clientData.context.data.invalidateData(userResource, "42"));

    expect(container.textContent).toBe("user-42-v2");
    expect(loads).toBe(2);
  }
});
