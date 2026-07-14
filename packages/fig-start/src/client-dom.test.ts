// @vitest-environment happy-dom
import {
  clientReference,
  createElement,
  dataResource,
  type FigDataStoreHandle,
  type FigNode,
  modulepreload,
  readData,
  readDataStore,
  readPromise,
  Suspense,
  stylesheet,
} from "@bgub/fig";
import { serverDataResource } from "@bgub/fig/server";
import { act } from "@bgub/fig-dom/test-utils";
import { describe, expect, it } from "vitest";
import { CLIENT_REFERENCE_MODULES_GLOBAL } from "./bootstrap.ts";
import { hydrateStart, remoteDataLoader } from "./client.ts";
import { Outlet } from "./components.tsx";
import { markServerRoute, serverClientReference } from "./internal.ts";
import type { AnyRoute } from "./route.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler } from "./server.ts";

// A manual client reference (the @bgub/fig-start/vite plugin generates these).
const islandId = "test/Island.tsx#Island";
const Island = clientReference({
  id: islandId,
});
const styledIslandId = "test/StyledIsland.tsx#StyledIsland";
const styledIslandHref = "http://[::1";
const StyledIsland = clientReference({
  id: styledIslandId,
  assets: [stylesheet(styledIslandHref)],
});
const ssrIslandId = "test/SsrIsland.tsx#SsrIsland";
const SsrIsland = serverClientReference({
  id: ssrIslandId,
  assets: [modulepreload("/assets/ssr-island.js")],
  ssr: RealSsrIsland,
});

function RealIsland(): FigNode {
  return createElement("span", { class: "island" }, "island!");
}

function RealStyledIsland(): FigNode {
  return createElement("span", { class: "styled-island" }, "styled!");
}

function RealSsrIsland(): FigNode {
  return createElement("button", { class: "ssr-island" }, "SSR island");
}

const routes = [
  createRootRoute({
    component: () => createElement("div", { id: "app" }, createElement(Outlet)),
  }),
  createFileRoute("/")({
    component: () => createElement("h1", null, "Home"),
  }),
  markServerRoute(
    createFileRoute("/dash")({
      component: () =>
        createElement(
          "section",
          null,
          createElement("p", { class: "static" }, "static markup"),
          createElement(Island, {}),
        ),
    }),
  ),
  markServerRoute(
    createFileRoute("/styled")({
      component: () =>
        createElement("section", null, createElement(StyledIsland, {})),
    }),
  ),
  markServerRoute(
    createFileRoute("/ssr")({
      component: () =>
        createElement(
          "section",
          null,
          createElement("p", { class: "static" }, "static markup"),
          createElement(SsrIsland, {}),
        ),
    }),
  ),
];

const resolveClientReference = ({ id }: { id: string }) =>
  id === islandId
    ? Promise.resolve(RealIsland)
    : id === styledIslandId
      ? Promise.resolve(RealStyledIsland)
      : id === ssrIslandId
        ? Promise.resolve(RealSsrIsland)
        : Promise.reject(new Error(`unknown client reference ${id}`));

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Render the document on the server, then install it as the live DOM (as the
// browser would on first load) so hydrateStart hydrates against real SSR markup.
async function installServerRenderedDocument(
  path: string,
  routeSet: readonly AnyRoute[] = routes,
): Promise<void> {
  const handler = createRequestHandler({
    clientEntry: "/client.js",
    routes: routeSet,
  });
  const response = await handler(new Request(`http://localhost${path}`));
  const html = await response.text();
  document.documentElement.innerHTML = html
    .replace(/^<!doctype[^>]*>/i, "")
    .replace(/^\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/i, "")
    // Drop the client bootstrap import script; hydrateStart is called manually.
    .replace(
      /<script(?:\s+nonce="[^"]*")?>import\("\/client\.js"\);<\/script>/gi,
      "",
    );
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), "http://localhost").href, init);
}

function installHandlerFetch(
  routeSet: readonly AnyRoute[] = routes,
): () => void {
  const handler = createRequestHandler({
    clientEntry: "/client.js",
    routes: routeSet,
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(toRequest(input, init));
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("@bgub/fig-start client payload mount (happy-dom)", () => {
  it("mounts a server route's payload, resolves its island, and tears down on nav", async () => {
    await installServerRenderedDocument("/dash");

    // The SSR'd document includes server-renderable payload markup immediately.
    const slot = document.querySelector('[data-fig-payload-slot="/dash"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector(".static")?.textContent).toBe("static markup");
    expect(slot?.querySelector("[data-fig-client-reference]")).not.toBeNull();

    const errors: unknown[] = [];
    const router = await act(() =>
      hydrateStart({
        resolveClientReference,
        onRecoverableError: (error) => errors.push(error),
        routes,
      }),
    );
    const mountedSlot = document.querySelector(
      '[data-fig-payload-slot="/dash"]',
    );
    expect(mountedSlot).toBe(slot);
    expect(errors).toEqual([]);

    // The island resolved through the resolver and client-rendered into the slot.
    expect(mountedSlot?.querySelector(".island")?.textContent).toBe("island!");

    // Static markup rendered beside the (async, suspending) island survives the
    // Suspense reveal — the sibling-drop bug this harness originally caught.
    expect(mountedSlot?.querySelector(".static")?.textContent).toBe(
      "static markup",
    );

    // Navigating away tears the route content down — the island is gone, no leak/stale.
    await act(() => router.navigate("/"));
    expect(document.body.textContent).toContain("Home");
    expect(document.querySelector(".island")).toBeNull();
  });

  it("marks the container interactive once replayable events are safe", async () => {
    await installServerRenderedDocument("/");

    const container = document.querySelector("#fig-root");
    expect(container?.hasAttribute("data-fig-start-hydrated")).toBe(false);

    hydrateStart({ resolveClientReference, routes });

    // Synchronously with hydrateStart returning: from this point clicks are
    // queued and replayed even before the shell commits, so tests and
    // tooling can gate first interactions on the attribute.
    expect(container?.hasAttribute("data-fig-start-hydrated")).toBe(true);
  });

  it("hydrates SSR-rendered client references without replacing them with templates", async () => {
    await installServerRenderedDocument("/ssr");
    (globalThis as Record<string, unknown>)[CLIENT_REFERENCE_MODULES_GLOBAL] = {
      [ssrIslandId]: { SsrIsland: RealSsrIsland },
    };

    try {
      const slot = document.querySelector('[data-fig-payload-slot="/ssr"]');
      const button = slot?.querySelector(".ssr-island");
      expect(button?.textContent).toBe("SSR island");
      expect(slot?.querySelector("[data-fig-client-reference]")).toBeNull();

      const errors: unknown[] = [];
      hydrateStart({
        resolveClientReference,
        onRecoverableError: (error) => errors.push(error),
        routes,
      });
      await flush();

      const hydratedSlot = document.querySelector(
        '[data-fig-payload-slot="/ssr"]',
      );
      expect(hydratedSlot?.querySelector(".ssr-island")).toBe(button);
      expect(hydratedSlot?.querySelector(".ssr-island")?.textContent).toBe(
        "SSR island",
      );
      expect(
        hydratedSlot?.querySelector("[data-fig-client-reference]"),
      ).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>)[
        CLIENT_REFERENCE_MODULES_GLOBAL
      ];
    }
  });

  it("fetches a server route's payload when navigating on the client", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();
    const requests: Request[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      requests.push(toRequest(input, init));
      return previousFetch(input, init);
    };

    try {
      const router = hydrateStart({ routes, resolveClientReference });
      await flush();
      expect(document.body.textContent).toContain("Home");

      await router.navigate("/dash");
      await flush();

      const slot = document.querySelector('[data-fig-payload-slot="/dash"]');
      expect(slot?.querySelector(".static")?.textContent).toBe("static markup");
      expect(slot?.querySelector(".island")?.textContent).toBe("island!");
      // The resource model sends no targeted-refresh header.
      expect(requests.at(-1)?.headers.get("x-fig-payload-boundary")).toBeNull();
    } finally {
      globalThis.fetch = previousFetch;
      restoreFetch();
    }
  });

  it("keeps the previous route visible until a navigated server route can render", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();
    const previousFetch = globalThis.fetch;
    const dashGate = deferred<void>();
    globalThis.fetch = async (input, init) => {
      const request = toRequest(input, init);
      if (new URL(request.url).pathname === "/dash") await dashGate.promise;
      return previousFetch(input, init);
    };

    try {
      const router = hydrateStart({ routes, resolveClientReference });
      await flush();
      expect(document.body.textContent).toContain("Home");

      const navigation = router.navigate("/dash");
      await flush();

      // The payload is still in flight: the previous route must stay
      // mounted instead of committing to an empty server-route slot.
      expect(document.body.textContent).toContain("Home");
      expect(
        document.querySelector('[data-fig-payload-slot="/dash"]'),
      ).toBeNull();

      dashGate.resolve(undefined);
      await navigation;
      await flush();

      const slot = document.querySelector('[data-fig-payload-slot="/dash"]');
      expect(slot?.querySelector(".static")?.textContent).toBe("static markup");
      expect(slot?.querySelector(".island")?.textContent).toBe("island!");
      expect(document.body.textContent).not.toContain("Home");
    } finally {
      globalThis.fetch = previousFetch;
      restoreFetch();
    }
  });

  it("keeps the previous route visible until navigated client references load", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();
    const islandResolution = deferred<typeof RealIsland>();
    const slowResolveClientReference = ({ id }: { id: string }) =>
      id === islandId
        ? islandResolution.promise
        : resolveClientReference({ id });

    try {
      const router = hydrateStart({
        resolveClientReference: slowResolveClientReference,
        routes,
      });
      await flush();
      expect(document.body.textContent).toContain("Home");

      let settled = false;
      const navigation = router.navigate("/dash").then(() => {
        settled = true;
      });
      await flush();

      expect(settled).toBe(false);
      expect(document.body.textContent).toContain("Home");
      expect(
        document.querySelector('[data-fig-payload-slot="/dash"]'),
      ).toBeNull();

      islandResolution.resolve(RealIsland);
      await navigation;
      await flush();

      const slot = document.querySelector('[data-fig-payload-slot="/dash"]');
      expect(slot?.querySelector(".static")?.textContent).toBe("static markup");
      expect(slot?.querySelector(".island")?.textContent).toBe("island!");
      expect(document.body.textContent).not.toContain("Home");
    } finally {
      restoreFetch();
    }
  });

  it("refreshes an existing server route segment when navigating between its child routes", async () => {
    const nestedRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, "Home"),
      }),
      markServerRoute(
        createFileRoute("/payload-layout")({
          component: () =>
            createElement(
              "section",
              null,
              createElement("h2", null, "Server layout"),
              createElement(Outlet),
            ),
        }),
      ),
      createFileRoute("/payload-layout/a")({
        component: () => createElement("p", { class: "child" }, "Child A"),
      }),
      createFileRoute("/payload-layout/b")({
        component: () => createElement("p", { class: "child" }, "Child B"),
      }),
    ];
    await installServerRenderedDocument("/", nestedRoutes);
    const restoreFetch = installHandlerFetch(nestedRoutes);

    try {
      const router = hydrateStart({ routes: nestedRoutes });
      await router.navigate("/payload-layout/a");
      await flush();
      expect(document.querySelector(".child")?.textContent).toBe("Child A");

      await router.navigate("/payload-layout/b");
      await flush();

      expect(document.querySelector(".child")?.textContent).toBe("Child B");
      expect(document.body.textContent).not.toContain("Child AChild B");
    } finally {
      restoreFetch();
    }
  });

  it("keeps refreshed server route content visible until new stylesheets load", async () => {
    const nestedRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, "Home"),
      }),
      markServerRoute(
        createFileRoute("/payload-layout")({
          component: () =>
            createElement(
              "section",
              null,
              createElement("h2", null, "Server layout"),
              createElement(Outlet),
            ),
        }),
      ),
      createFileRoute("/payload-layout/a")({
        component: () => createElement("p", { class: "child" }, "Child A"),
      }),
      createFileRoute("/payload-layout/styled")({
        component: () => createElement(StyledIsland, {}),
      }),
    ];
    await installServerRenderedDocument("/", nestedRoutes);
    const restoreFetch = installHandlerFetch(nestedRoutes);
    const previousFetch = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = async (input, init) => {
      requests.push(toRequest(input, init));
      return previousFetch(input, init);
    };

    try {
      const router = hydrateStart({
        routes: nestedRoutes,
        resolveClientReference,
      });
      await router.navigate("/payload-layout/a");
      await flush();
      expect(document.querySelector(".child")?.textContent).toBe("Child A");

      const navigation = router.navigate("/payload-layout/styled");
      await flush();

      const link = document.head.querySelector('link[rel="stylesheet"]');
      expect(link?.getAttribute("href")).toBe(styledIslandHref);
      // Same-segment child navigation re-requests the segment as a plain
      // payload stream (no targeted-refresh header on the wire).
      expect(requests.at(-1)?.headers.get("accept")).toContain(
        "text/x-fig-payload",
      );
      expect(document.querySelector(".child")?.textContent).toBe("Child A");
      expect(document.querySelector(".styled-island")).toBeNull();

      link?.dispatchEvent(new Event("load"));
      await navigation;
      await flush();

      expect(document.querySelector(".child")).toBeNull();
      expect(document.querySelector(".styled-island")?.textContent).toBe(
        "styled!",
      );
    } finally {
      globalThis.fetch = previousFetch;
      restoreFetch();
    }
  });

  it("mounts an initial server route document payload without relying on client-reference suspension", async () => {
    const nestedRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      markServerRoute(
        createFileRoute("/payload-layout")({
          component: () =>
            createElement(
              "section",
              null,
              createElement("h2", null, "Server layout"),
              createElement(Outlet),
            ),
        }),
      ),
      createFileRoute("/payload-layout/a")({
        component: () => createElement("p", { class: "child" }, "Child A"),
      }),
    ];

    await installServerRenderedDocument("/payload-layout/a", nestedRoutes);
    hydrateStart({ routes: nestedRoutes });
    await flush();

    expect(document.querySelector(".child")?.textContent).toBe("Child A");
  });

  it("hydrates initial server route content with hoisted client-reference stylesheets", async () => {
    await installServerRenderedDocument("/styled");
    const errors: unknown[] = [];

    hydrateStart({
      resolveClientReference,
      onRecoverableError: (error) => errors.push(error),
      routes,
    });
    await flush();

    const slot = document.querySelector('[data-fig-payload-slot="/styled"]');
    const link = document.head.querySelector('link[rel="stylesheet"]');
    expect(errors).toEqual([]);
    expect(slot).not.toBeNull();
    expect(link).not.toBeNull();
    expect(slot?.querySelector(".styled-island")?.textContent).toBe("styled!");
  });

  it("hydrates document data streamed after the bootstrap snapshot", async () => {
    const pending = deferred<string>();
    let loadCalls = 0;
    const resource = serverDataResource<[string], string>({
      key: (id) => ["client-document-stream", id],
      load: () => {
        loadCalls += 1;
        return pending.promise;
      },
    });
    function SlowData(): FigNode {
      return createElement(
        "span",
        { class: "data" },
        readData(resource, "one"),
      );
    }
    const dataRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/data")({
        component: () =>
          createElement(
            Suspense,
            { fallback: createElement("p", null, "Loading") },
            createElement(SlowData),
          ),
      }),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: dataRoutes,
    });
    const response = await handler(new Request("http://localhost/data"));
    const text = response.text();
    await flush();
    expect(loadCalls).toBe(1);
    pending.resolve("Streamed data");
    const html = await text;

    document.documentElement.innerHTML = html
      .replace(/^<!doctype[^>]*>/i, "")
      .replace(/^\s*<html[^>]*>/i, "")
      .replace(/<\/html>\s*$/i, "")
      .replace(
        /<script(?:\s+nonce="[^"]*")?>import\("\/client\.js"\);<\/script>/gi,
        "",
      );

    hydrateStart({ routes: dataRoutes });
    await flush();

    expect(document.querySelector(".data")?.textContent).toBe("Streamed data");
    expect(loadCalls).toBe(1);
  });

  it("hydrates streamed document data frames with shared graph entries", async () => {
    let resolveShared: (value: { label: string }) => void = () => undefined;
    const pending = new Promise<{ label: string }>((resolve) => {
      resolveShared = resolve;
    });
    const first = serverDataResource<[], { label: string }>({
      key: () => ["client-shared-frame", "first"],
      load: () => pending,
    });
    const second = serverDataResource<[], { label: string }>({
      key: () => ["client-shared-frame", "second"],
      load: () => pending,
    });

    function FirstData(): FigNode {
      readData(first);
      return null;
    }
    function SecondData(): FigNode {
      readData(second);
      return null;
    }
    function SharedData(): FigNode {
      return createElement(
        "span",
        { class: "shared-data" },
        readData(first) === readData(second) ? "same" : "split",
      );
    }

    const dataRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/shared-data")({
        component: () =>
          createElement(
            Suspense,
            { fallback: createElement("p", null, "Loading") },
            [
              createElement(FirstData, null),
              createElement(SecondData, null),
              createElement(SharedData, null),
            ],
          ),
      }),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: dataRoutes,
    });
    const response = await handler(new Request("http://localhost/shared-data"));
    const text = response.text();
    await flush();
    resolveShared({ label: "shared" });
    const html = await text;

    document.documentElement.innerHTML = html
      .replace(/^<!doctype[^>]*>/i, "")
      .replace(/^\s*<html[^>]*>/i, "")
      .replace(/<\/html>\s*$/i, "")
      .replace(
        /<script(?:\s+nonce="[^"]*")?>import\("\/client\.js"\);<\/script>/gi,
        "",
      );

    hydrateStart({ routes: dataRoutes });
    await flush();

    expect(document.querySelector(".shared-data")?.textContent).toBe("same");
  });

  it("reloads a server route whose entry lost authority before committing back-navigation", async () => {
    // Stands in for inactivity eviction: hydrate-over aborts the fulfilled
    // load generation through the same signal, so the route store must
    // unlearn its "already loaded" mark and re-request before the commit.
    let dataHandle: FigDataStoreHandle | null = null;
    const evictionRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/")({
        component: () => {
          dataHandle = readDataStore();
          return createElement("h1", null, "Home");
        },
      }),
      markServerRoute(
        createFileRoute("/dash")({
          component: () =>
            createElement("p", { class: "static" }, "static markup"),
        }),
      ),
    ];
    await installServerRenderedDocument("/", evictionRoutes);
    const restoreFetch = installHandlerFetch(evictionRoutes);
    const previousFetch = globalThis.fetch;
    let dashRequests = 0;
    globalThis.fetch = async (input, init) => {
      const request = toRequest(input, init);
      if (new URL(request.url).pathname === "/dash") dashRequests += 1;
      return previousFetch(request);
    };

    try {
      const router = hydrateStart({ routes: evictionRoutes });
      await flush();
      expect(dataHandle).not.toBeNull();

      await router.navigate("/dash");
      await flush();
      expect(document.querySelector(".static")?.textContent).toBe(
        "static markup",
      );
      expect(dashRequests).toBe(1);

      await router.navigate("/");
      await flush();

      // Revoke the entry's generation (the eviction/hydrate-over channel).
      // (Cast: TS cannot see the render-callback assignment above.)
      (dataHandle as FigDataStoreHandle | null)?.hydrate([
        { key: ["fig-start", "server-route", "/dash", "/dash"], value: null },
      ]);

      await router.navigate("/dash");
      await flush();

      // Without the signal-tied unmark, the store would trust its stale
      // "loaded" mark, skip the pre-commit request, and commit the hydrated
      // null into the slot.
      expect(dashRequests).toBe(2);
      expect(document.querySelector(".static")?.textContent).toBe(
        "static markup",
      );
    } finally {
      globalThis.fetch = previousFetch;
      restoreFetch();
    }
  });

  it("fetches remote data resources for client route cache misses", async () => {
    let loadCalls = 0;
    // Mirrors the browser stub the Fig Start transform emits for a
    // remoteDataResource declaration.
    const clientResource = dataResource<[string], string>({
      key: (id) => ["remote-client-user", id],
      load: remoteDataLoader("test#remoteUser") as (
        id: string,
        context: { signal: AbortSignal },
      ) => Promise<string>,
    });
    const serverResource = serverDataResource<[string], string>({
      key: (id: string) => ["remote-client-user", id],
      load: (id: string) => {
        loadCalls += 1;
        return `User ${id}`;
      },
    });
    function RemoteUser(): FigNode {
      return createElement(
        "span",
        { class: "remote-user" },
        readData(clientResource, "one"),
      );
    }
    const remoteRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, "Home"),
      }),
      createFileRoute("/remote")({
        component: () =>
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Loading") },
            createElement(RemoteUser),
          ),
      }),
    ];
    await installServerRenderedDocument("/", remoteRoutes);
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: remoteRoutes,
      serverDataResources: {
        "test#remoteUser": serverResource,
      },
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => handler(toRequest(input, init));

    try {
      const router = hydrateStart({ routes: remoteRoutes });
      await router.navigate("/remote");
      await flush();

      expect(document.querySelector(".remote-user")?.textContent).toBe(
        "User one",
      );
      expect(loadCalls).toBe(1);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("reports missing client-reference resolvers during server route navigation", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();
    const errors: unknown[] = [];

    try {
      const router = hydrateStart({
        onRecoverableError: (error) => errors.push(error),
        routes,
      });

      await router.navigate("/dash");
      await flush();

      expect(
        errors.some((error) =>
          String(error).includes("client-reference resolver"),
        ),
      ).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("inserts and gates server route client-reference stylesheets", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();

    try {
      const router = hydrateStart({ routes, resolveClientReference });
      const navigation = router.navigate("/styled");
      await flush();

      const link = document.head.querySelector('link[rel="stylesheet"]');
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe(styledIslandHref);
      // The stylesheet gate holds the whole navigation: nothing commits yet.
      expect(
        document.querySelector('[data-fig-payload-slot="/styled"]'),
      ).toBeNull();

      link?.dispatchEvent(new Event("load"));
      await navigation;
      await flush();

      const slot = document.querySelector('[data-fig-payload-slot="/styled"]');
      expect(slot?.querySelector(".styled-island")?.textContent).toBe(
        "styled!",
      );
    } finally {
      restoreFetch();
    }
  });

  it("ignores server route stylesheet gates after navigation away", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();

    try {
      const router = hydrateStart({ routes, resolveClientReference });
      const navigation = router.navigate("/styled");
      await flush();

      const link = document.head.querySelector('link[rel="stylesheet"]');
      expect(link).not.toBeNull();
      expect(document.querySelector(".styled-island")).toBeNull();

      // Superseding navigation abandons the gated one entirely.
      await router.navigate("/");
      link?.dispatchEvent(new Event("load"));
      await navigation;
      await flush();

      expect(document.body.textContent).toContain("Home");
      expect(document.querySelector(".styled-island")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("aborts stale server route fetches when navigating away", async () => {
    const pending = deferred<string>();
    const slowRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, "Home"),
      }),
      markServerRoute(
        createFileRoute("/slow")({
          component: () =>
            createElement("section", null, readPromise(pending.promise)),
        }),
      ),
    ];

    await installServerRenderedDocument("/", slowRoutes);
    const restoreFetch = installHandlerFetch(slowRoutes);

    try {
      const router = hydrateStart({ routes: slowRoutes });
      const navigation = router.navigate("/slow");
      await flush();
      // The payload is still streaming, so the navigation has not committed.
      expect(
        document.querySelector('[data-fig-payload-slot="/slow"]'),
      ).toBeNull();
      expect(document.body.textContent).toContain("Home");

      await router.navigate("/");
      pending.resolve("too late");
      await navigation;
      await flush();

      expect(document.body.textContent).toContain("Home");
      expect(document.body.textContent).not.toContain("too late");
    } finally {
      restoreFetch();
    }
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
