import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clientReference,
  createElement,
  type FigNode,
  modulepreload,
  readData,
  readPromise,
  Suspense,
  stylesheet,
} from "@bgub/fig";
import { serverDataResource } from "@bgub/fig/server";
import { createPayloadResponse } from "@bgub/fig-server/payload";
import { describe, expect, it } from "vitest";
import {
  CLIENT_REFERENCE_MODULES_GLOBAL,
  DATA_ENDPOINT_PATH,
  DATA_FRAME_ATTR,
  DATA_SCRIPT_ID,
  PAYLOAD_BOUNDARY_HEADER,
  PAYLOAD_FRAME_ATTR,
  PAYLOAD_ROUTE_ID_HEADER,
  PAYLOAD_SEGMENT_ID_HEADER,
  PAYLOAD_SEGMENTS_SCRIPT_ID,
  PAYLOAD_SLOT_ATTR,
  ROUTER_STATE_SCRIPT_ID,
} from "./bootstrap.ts";
import { Outlet } from "./components.tsx";
import { markServerRoute, serverClientReference } from "./internal.ts";
import { redirect } from "./redirect.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler, remoteDataResource } from "./server.ts";
import { createClientAssetResolver } from "./server-assets.ts";

// A manually-declared client reference (the @bgub/fig-start/vite plugin will
// generate these from `.tsx` imports inside `.server.tsx`).
const islandId = "test/Island.tsx#Island";
const Island = clientReference({
  id: islandId,
  load: () => Promise.resolve({}),
});
const ssrIslandId = "test/SsrIsland.tsx#SsrIsland";
function SsrIslandImpl(): FigNode {
  return createElement("button", { class: "ssr-island" }, "SSR island");
}
const SsrIsland = serverClientReference({
  id: ssrIslandId,
  load: () => Promise.resolve({ SsrIsland: SsrIslandImpl }),
  assets: [modulepreload("/assets/ssr-island.js")],
  ssr: SsrIslandImpl,
});

const dashboardRoute = markServerRoute(
  createFileRoute("/dashboard")({
    component: () =>
      createElement(
        "section",
        null,
        "server markup ",
        createElement(Island, {}),
      ),
  }),
);

const ssrIslandRoute = markServerRoute(
  createFileRoute("/ssr-island")({
    component: () =>
      createElement(
        "section",
        null,
        "before ",
        createElement(SsrIsland, {}),
        " after",
      ),
  }),
);

const postRoute = createFileRoute("/posts/$postId")({
  loader: ({ params }) => ({ id: params.postId }),
  component: PostView,
});

const serverPostRoute = markServerRoute(
  createFileRoute("/server-posts/$postId")({
    loader: ({ params }) => ({ id: params.postId }),
    component: ServerPostView,
  }),
);

// Annotate the return type to break the self-reference cycle (the component
// reads its own route's typed hooks).
function PostView(): FigNode {
  // Typed straight from the loader return and the path literal, no codegen.
  const data = postRoute.useLoaderData();
  const params = postRoute.useParams();
  return createElement("h1", null, `Post ${data.id} (${params.postId})`);
}

function ServerPostView(): FigNode {
  const data = serverPostRoute.useLoaderData();
  const params = serverPostRoute.useParams();
  return createElement(
    "article",
    null,
    `Server post ${data.id} (${params.postId})`,
  );
}

const routes = [
  createRootRoute({
    component: () =>
      createElement("div", { id: "root-layout" }, createElement(Outlet)),
    notFoundComponent: () => createElement("p", null, "Nothing here"),
  }),
  createFileRoute("/")({
    component: () => createElement("h1", null, "Home page"),
  }),
  createFileRoute("/about")({
    component: () => createElement("h1", null, "About page"),
  }),
  createFileRoute("/guarded")({
    beforeLoad: ({ context }) => {
      if (!(context as { allow: boolean }).allow) throw redirect({ to: "/" });
    },
    component: () => createElement("h1", null, "Secret"),
  }),
  postRoute,
  serverPostRoute,
  dashboardRoute,
  ssrIslandRoute,
];

function handlerFor(allow: boolean) {
  return createRequestHandler({
    clientEntry: "/client.js",
    context: () => ({ allow }),
    routes,
  });
}

describe("@bgub/fig-start server handler", () => {
  it("renders the matched route into a full document with bootstrap", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/about"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<html");
    expect(html).toContain("About page");
    expect(html).toContain(`id="fig-root"`);
    expect(html).toContain(ROUTER_STATE_SCRIPT_ID);
    expect(html).toContain("/client.js");
    // bootstrap injected before </body>
    expect(html.indexOf(ROUTER_STATE_SCRIPT_ID)).toBeLessThan(
      html.indexOf("</body>"),
    );
  });

  it("allows apps to set per-request html props", async () => {
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      html: () => ({ class: "dark", suppressHydrationWarning: true }),
      routes,
    });

    const response = await handler(new Request("http://localhost/about"));
    const html = await response.text();

    expect(html).toContain('<html lang="en" class="dark">');
    expect(html).not.toContain("suppressHydrationWarning");
  });

  it("serializes loader data for hydration", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/posts/42"),
    );
    const html = await response.text();

    expect(html).toContain("Post 42");
    expect(html).toContain('"/posts/$postId"');
    expect(html).toContain('"id":"42"');
  });

  it("responds with a redirect when beforeLoad throws", async () => {
    const response = await handlerFor(false)(
      new Request("http://localhost/guarded"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  it("renders the not-found component with a 404 status", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/does/not/exist"),
    );
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain("Nothing here");
  });

  it("streams a payload segment + SSR slot for a .server.tsx route", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/dashboard"),
    );
    const html = await response.text();

    expect(html).toContain(`${PAYLOAD_SLOT_ATTR}="/dashboard"`);
    expect(html).toContain("server markup ");
    expect(html).toContain("data-fig-client-reference");
    // The payload is streamed as segment metadata plus row frame scripts.
    expect(html).toContain(PAYLOAD_SEGMENTS_SCRIPT_ID);
    expect(html).toContain(PAYLOAD_FRAME_ATTR);
    expect(html).toContain(islandId);
    expect(html).toContain('"routeId":"/dashboard"');
    expect(html.indexOf(PAYLOAD_FRAME_ATTR)).toBeLessThan(
      html.indexOf(PAYLOAD_SEGMENTS_SCRIPT_ID),
    );
  });

  it("server-renders SSR-capable client references and preloads their modules", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/ssr-island"),
    );
    const html = await response.text();

    expect(html).toContain('<button class="ssr-island">SSR island</button>');
    expect(html).not.toContain(`data-fig-client-reference="${ssrIslandId}"`);
    expect(html).toContain(ssrIslandId);
    expect(html).toContain('\\"ssr\\":true');
    expect(html).toContain('const m0 = await import("/assets/ssr-island.js");');
    expect(html).toContain(`globalThis["${CLIENT_REFERENCE_MODULES_GLOBAL}"]`);
    expect(html).toContain(`registry["${ssrIslandId}"] = m0;`);
    expect(html).toContain('await import("/client.js");');
    expect(html.indexOf(`registry["${ssrIslandId}"] = m0;`)).toBeLessThan(
      html.indexOf('await import("/client.js");'),
    );
  });

  it("serves raw payload rows for client navigation requests", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/dashboard", {
        headers: { accept: "text/x-fig-payload; charset=utf-8" },
      }),
    );
    const rows = await response.text();

    expect(response.headers.get("content-type")).toContain(
      "text/x-fig-payload",
    );
    expect(response.headers.get(PAYLOAD_ROUTE_ID_HEADER)).toBe("/dashboard");
    expect(response.headers.get(PAYLOAD_SEGMENT_ID_HEADER)).toBe("/dashboard");
    expect(rows).toContain(islandId);
    expect(rows).not.toContain(PAYLOAD_FRAME_ATTR);
    expect(rows).not.toContain("<html");
  });

  it("provides route hook context while rendering server route payload rows", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/server-posts/42", {
        headers: { accept: "text/x-fig-payload; charset=utf-8" },
      }),
    );
    const rows = await response.text();

    expect(response.headers.get("content-type")).toContain(
      "text/x-fig-payload",
    );
    expect(response.headers.get(PAYLOAD_ROUTE_ID_HEADER)).toBe(
      "/server-posts/$postId",
    );
    expect(rows).toContain("Server post 42 (42)");
    expect(rows).not.toContain("Router hooks must be used");
  });

  it("renders child routes under a server route layout", async () => {
    const nestedRoutes = [
      createRootRoute({
        component: () => createElement("main", null, createElement(Outlet)),
      }),
      markServerRoute(
        createFileRoute("/payload-layout")({
          component: () =>
            createElement(
              "section",
              null,
              createElement("h1", null, "Server layout"),
              createElement(Outlet),
            ),
        }),
      ),
      createFileRoute("/payload-layout/child")({
        component: () => createElement("p", null, "Nested child"),
      }),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: nestedRoutes,
    });

    const document = await handler(
      new Request("http://localhost/payload-layout/child"),
    );
    const html = await document.text();
    expect(html).toContain("Server layout");
    expect(html).toContain("Nested child");
    expect(html).toContain(`${PAYLOAD_SLOT_ATTR}="/payload-layout"`);

    const payload = await handler(
      new Request("http://localhost/payload-layout/child", {
        headers: { accept: "text/x-fig-payload; charset=utf-8" },
      }),
    );
    const rows = await payload.text();
    expect(payload.headers.get(PAYLOAD_ROUTE_ID_HEADER)).toBe(
      "/payload-layout",
    );
    expect(rows).toContain("Server layout");
    expect(rows).toContain("Nested child");
  });

  it("renders same-segment payload refreshes as boundary rows", async () => {
    const nestedRoutes = [
      createRootRoute({
        component: () => createElement("main", null, createElement(Outlet)),
      }),
      markServerRoute(
        createFileRoute("/payload-layout")({
          component: () =>
            createElement(
              "section",
              null,
              createElement("h1", null, "Server layout"),
              createElement(Outlet),
            ),
        }),
      ),
      createFileRoute("/payload-layout/a")({
        component: () => createElement("p", null, "Child A"),
      }),
      createFileRoute("/payload-layout/b")({
        component: () => createElement("p", null, "Child B"),
      }),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: nestedRoutes,
    });

    const response = await handler(
      new Request("http://localhost/payload-layout/b", {
        headers: {
          accept: "text/x-fig-payload; charset=utf-8",
          [PAYLOAD_BOUNDARY_HEADER]: "/payload-layout",
        },
      }),
    );
    const rows = await response.text();

    expect(response.headers.get(PAYLOAD_ROUTE_ID_HEADER)).toBe(
      "/payload-layout",
    );
    expect(rows).toContain('"tag":"refresh"');
    expect(rows).toContain('"boundary":"/payload-layout"');
    expect(rows).toContain('"type":"section"');
    expect(rows).not.toContain('"type":{"$fig":"fragment"}');
    expect(rows).toContain("Child B");
  });

  it("streams document data discovered after the bootstrap snapshot", async () => {
    const pending = deferred<string>();
    const resource = serverDataResource<[string], string>({
      key: (id) => ["document-stream", id],
      load: () => pending.promise,
    });
    function SlowData(): FigNode {
      return createElement("span", null, readData(resource, "one"));
    }
    const dataRoutes = [
      createRootRoute({
        component: () => createElement("main", null, createElement(Outlet)),
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
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected response body.");
    const decoder = new TextDecoder();
    const firstText = await readUntil(reader, decoder, DATA_SCRIPT_ID);

    expect(firstText).toContain("Loading");
    expect(firstText).not.toContain("Streamed value");

    pending.resolve("Streamed value");
    const rest = await readRemaining(reader, decoder);

    expect(rest).toContain(DATA_FRAME_ATTR);
    expect(rest).toContain("Streamed value");
  });

  it("serves only registered remote data resources", async () => {
    const remoteResource = remoteDataResource({
      key: (id: string) => ["remote-endpoint", id],
      load: async (id: string) => `user-${id}`,
    });
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes,
      serverDataResources: {
        "test#remoteResource": remoteResource,
      },
    });

    const response = await handler(
      new Request(`http://localhost${DATA_ENDPOINT_PATH}`, {
        body: JSON.stringify({
          args: ["one"],
          id: "test#remoteResource",
        }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      key: ["remote-endpoint", "one"],
      value: "user-one",
    });

    const missing = await handler(
      new Request(`http://localhost${DATA_ENDPOINT_PATH}`, {
        body: JSON.stringify({
          args: ["one"],
          id: "test#missing",
        }),
        method: "POST",
      }),
    );
    expect(missing.status).toBe(404);
  });

  it("serves configured static assets", async () => {
    const handler = createRequestHandler({
      assets: {
        "/assets/chunk.js": "export const value = 1;",
        "/assets/card.css": ".card { color: red; }",
        "/assets/mark.svg": {
          content: "<svg></svg>",
          contentType: "image/svg+xml",
        },
      },
      clientEntry: "/client.js",
      routes,
    });

    const js = await handler(new Request("http://localhost/assets/chunk.js"));
    const css = await handler(new Request("http://localhost/assets/card.css"));
    const svg = await handler(new Request("http://localhost/assets/mark.svg"));

    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await js.text()).toBe("export const value = 1;");
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toBe(".card { color: red; }");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(await svg.text()).toBe("<svg></svg>");
  });

  it("uses client-reference asset resolvers for server route payload rows", async () => {
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      clientReferenceAssets: ({ id }) =>
        id === islandId ? stylesheet("/assets/island.css") : [],
      context: () => ({ allow: true }),
      routes,
    });

    const response = await handler(
      new Request("http://localhost/dashboard", {
        headers: { accept: "text/x-fig-payload; charset=utf-8" },
      }),
    );
    const rows = await response.text();

    expect(rows).toContain(islandId);
    expect(rows).toContain("/assets/island.css");
  });

  it("uses server-route asset resolvers for server route payload rows", async () => {
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      clientReferenceAssets: ({ id }) =>
        id === islandId ? stylesheet("/assets/island.css") : [],
      context: () => ({ allow: true }),
      routes,
      serverRouteAssets: ({ id }) =>
        id === "/dashboard" ? stylesheet("/assets/dashboard.css") : [],
    });

    const response = await handler(
      new Request("http://localhost/dashboard", {
        headers: { accept: "text/x-fig-payload; charset=utf-8" },
      }),
    );
    const rows = await response.text();
    const payload = createPayloadResponse();
    payload.processStringChunk(rows);

    expect(rows).toContain("/assets/dashboard.css");
    expect(payload.getAssetResources()).toEqual([
      stylesheet("/assets/dashboard.css"),
      stylesheet("/assets/island.css"),
    ]);
  });

  it("hoists initial server-route assets into the document head", async () => {
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      clientReferenceAssets: ({ id }) =>
        id === islandId ? stylesheet("/assets/island.css") : [],
      context: () => ({ allow: true }),
      routes,
      serverRouteAssets: ({ id }) =>
        id === "/dashboard" ? stylesheet("/assets/dashboard.css") : [],
    });

    const response = await handler(new Request("http://localhost/dashboard"));
    const html = await response.text();
    const head = html.slice(0, html.indexOf("</head>"));

    expect(head).toContain(
      '<link rel="stylesheet" href="/assets/dashboard.css"',
    );
    expect(head).toContain('<link rel="stylesheet" href="/assets/island.css"');
  });

  it("omits payload frames for ordinary isomorphic routes", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/about"),
    );
    const html = await response.text();
    expect(html).toContain(`<script id="${PAYLOAD_SEGMENTS_SCRIPT_ID}"`);
    expect(html).toContain("[]");
    expect(html).not.toContain(PAYLOAD_FRAME_ATTR);
  });

  it("sends the document bootstrap before a slow payload segment completes", async () => {
    const pending = deferred<string>();
    const slowRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "root-layout" }, createElement(Outlet)),
      }),
      markServerRoute(
        createFileRoute("/slow")({
          component: () =>
            createElement("section", null, readPromise(pending.promise)),
        }),
      ),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: slowRoutes,
    });

    const response = await handler(new Request("http://localhost/slow"));
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected response body.");

    const decoder = new TextDecoder();
    const firstText = await readUntil(
      reader,
      decoder,
      PAYLOAD_SEGMENTS_SCRIPT_ID,
    );

    expect(firstText).toContain(`${PAYLOAD_SLOT_ATTR}="/slow"`);
    expect(firstText).toContain("fig:suspense:pending");
    expect(firstText).toContain(PAYLOAD_SEGMENTS_SCRIPT_ID);
    expect(firstText).not.toContain("slow ready");

    pending.resolve("slow ready");
    const rest = await readRemaining(reader, decoder);
    expect(rest).toContain("slow ready");
  });

  it("logs streamed payload render errors", async () => {
    const errorRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "root-layout" }, createElement(Outlet)),
      }),
      markServerRoute(
        createFileRoute("/broken")({
          component: () => {
            throw new Error("payload exploded");
          },
        }),
      ),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: errorRoutes,
    });
    const previousError = console.error;
    const messages: string[] = [];
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };

    try {
      const response = await handler(new Request("http://localhost/broken"));
      const html = await response.text();
      expect(html).toContain(PAYLOAD_FRAME_ATTR);
      // Only the digest crosses the wire; the raw server message stays out of
      // the payload and lands in the server log instead.
      expect(html).toContain("fig-start-error");
      expect(html).not.toContain("payload exploded");
    } finally {
      console.error = previousError;
    }

    expect(
      messages.some((message) => message.includes("payload exploded")),
    ).toBe(true);
  });

  it("renders server route components once for document HTML and payload frames", async () => {
    let renders = 0;
    const singlePassRoutes = [
      createRootRoute({
        component: () => createElement("main", null, createElement(Outlet)),
      }),
      markServerRoute(
        createFileRoute("/single-pass")({
          component: () => {
            renders += 1;
            return createElement("h1", null, "Single pass");
          },
        }),
      ),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: singlePassRoutes,
    });

    const response = await handler(new Request("http://localhost/single-pass"));
    const html = await response.text();

    expect(html).toContain("Single pass");
    expect(html).toContain(PAYLOAD_FRAME_ATTR);
    expect(renders).toBe(1);
  });

  it("resolves only built client chunks next to the client entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fig-start-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "server.js"), "server secret");
    await writeFile(join(dir, "server-helper.js"), "server helper secret");
    await writeFile(join(dir, "assets", "client.js"), "client entry");
    await writeFile(join(dir, "assets", "client.css"), ".app{}");
    await writeFile(join(dir, "assets", "style.css"), ".island{}");
    await writeFile(
      join(dir, "assets", "Island-test.js"),
      "export const value = 1;",
    );
    await writeFile(
      join(dir, "fig-start-client-assets.json"),
      JSON.stringify({
        assets: ["/assets/client.css"],
        client: {
          module: "/assets/client.js",
        },
        clientReferences: {
          Island: {
            css: ["/assets/style.css"],
            module: "/assets/Island-test.js",
          },
        },
        serverRoutes: {},
      }),
    );

    const resolver = createClientAssetResolver({
      appUrl: pathToFileURL(join(dir, "server.js")).href,
      clientEntry: "/assets/client.js",
    });

    try {
      expect((await resolver.resolve("/assets/client.js"))?.href).toBe(
        pathToFileURL(join(dir, "assets", "client.js")).href,
      );
      expect((await resolver.resolve("/assets/client.css"))?.href).toBe(
        pathToFileURL(join(dir, "assets", "client.css")).href,
      );
      expect((await resolver.resolve("/assets/Island-test.js"))?.href).toBe(
        pathToFileURL(join(dir, "assets", "Island-test.js")).href,
      );
      expect((await resolver.resolve("/assets/style.css"))?.href).toBe(
        pathToFileURL(join(dir, "assets", "style.css")).href,
      );
      expect(await resolver.resolve("/dashboard")).toBe(null);
      expect(await resolver.resolve("/server.js")).toBe(null);
      expect(await resolver.resolve("/server-helper.js")).toBe(null);
      expect(await resolver.resolve("/%73erver.js")).toBe(null);
      expect(await resolver.resolve("/assets/%2e%2e/server.js")).toBe(null);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("serves only the client entry when the asset manifest is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fig-start-"));
    await writeFile(join(dir, "server.js"), "server secret");
    await writeFile(join(dir, "client.js"), "client entry");
    await writeFile(join(dir, "Island-test.js"), "unmanifested chunk");

    const resolver = createClientAssetResolver({
      appUrl: pathToFileURL(join(dir, "server.js")).href,
      cache: false,
      clientEntry: "/client.js",
    });

    try {
      expect((await resolver.resolve("/client.js"))?.href).toBe(
        pathToFileURL(join(dir, "client.js")).href,
      );
      expect(await resolver.resolve("/Island-test.js")).toBe(null);
      expect(await resolver.resolve("/server.js")).toBe(null);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("re-discovers client chunks when asset caching is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fig-start-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "server.js"), "server");
    await writeFile(join(dir, "assets", "client.js"), "client entry");
    await writeFile(join(dir, "assets", "old.js"), "export const old = true;");
    await writeFile(
      join(dir, "fig-start-client-assets.json"),
      JSON.stringify({
        clientReferences: {
          Island: { module: "/assets/old.js" },
        },
        serverRoutes: {},
      }),
    );

    const resolver = createClientAssetResolver({
      appUrl: pathToFileURL(join(dir, "server.js")).href,
      cache: false,
      clientEntry: "/assets/client.js",
    });

    try {
      expect((await resolver.resolve("/assets/old.js"))?.href).toBe(
        pathToFileURL(join(dir, "assets", "old.js")).href,
      );

      await writeFile(
        join(dir, "fig-start-client-assets.json"),
        JSON.stringify({
          clientReferences: {
            Island: { module: "/assets/new.js" },
          },
          serverRoutes: {},
        }),
      );
      await writeFile(
        join(dir, "assets", "new.js"),
        "export const updated = true;",
      );

      expect((await resolver.resolve("/assets/new.js"))?.href).toBe(
        pathToFileURL(join(dir, "assets", "new.js")).href,
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
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

async function readRemaining(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
): Promise<string> {
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      output += decoder.decode();
      return output;
    }
    output += decoder.decode(value, { stream: true });
  }
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  marker: string,
): Promise<string> {
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`Stream ended before ${marker}.`);
    output += decoder.decode(value, { stream: true });
    if (output.includes(marker)) return output;
  }
}
