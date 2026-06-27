import {
  clientReference,
  createElement,
  type FigNode,
  readPromise,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import {
  hasClientReferences,
  RSC_FRAME_ATTR,
  RSC_ROUTE_ID_HEADER,
  RSC_SEGMENTS_SCRIPT_ID,
  RSC_SEGMENT_ID_HEADER,
  RSC_SLOT_ATTR,
  ROUTER_STATE_SCRIPT_ID,
} from "./bootstrap.ts";
import { Outlet } from "./components.tsx";
import { redirect } from "./redirect.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler } from "./server.ts";

// A manually-declared client reference (the @bgub/fig-start/vite plugin will
// generate these from `.tsx` imports inside `.server.tsx`).
const islandId = "test/Island.tsx#Island";
const Island = clientReference({
  id: islandId,
  load: () => Promise.resolve({}),
});

const dashboardRoute = createFileRoute("/dashboard")({
  server: true,
  component: () =>
    createElement("section", null, "server markup ", createElement(Island, {})),
});

const postRoute = createFileRoute("/posts/$postId")({
  loader: ({ params }) => ({ id: params.postId }),
  component: PostView,
});

// Annotate the return type to break the self-reference cycle (the component
// reads its own route's typed hooks).
function PostView(): FigNode {
  // Typed straight from the loader return and the path literal, no codegen.
  const data = postRoute.useLoaderData();
  const params = postRoute.useParams();
  return createElement("h1", null, `Post ${data.id} (${params.postId})`);
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
  dashboardRoute,
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

  it("streams an RSC segment + empty slot for a .server.tsx route", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/dashboard"),
    );
    const html = await response.text();

    // SSR leaves an empty slot in the isomorphic layout (the server component
    // is not rendered into the document — it has client refs that can't SSR).
    expect(html).toContain(`${RSC_SLOT_ATTR}="/dashboard"></div>`);
    // The RSC payload is streamed as segment metadata plus row frame scripts.
    expect(html).toContain(RSC_SEGMENTS_SCRIPT_ID);
    expect(html).toContain(RSC_FRAME_ATTR);
    expect(html).toContain(islandId);
    expect(html).toContain('"routeId":"/dashboard"');
  });

  it("serves raw RSC rows for client navigation requests", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/dashboard", {
        headers: { accept: "text/x-component; charset=utf-8" },
      }),
    );
    const rows = await response.text();

    expect(response.headers.get("content-type")).toContain("text/x-component");
    expect(response.headers.get(RSC_ROUTE_ID_HEADER)).toBe("/dashboard");
    expect(response.headers.get(RSC_SEGMENT_ID_HEADER)).toBe("/dashboard");
    expect(rows).toContain(islandId);
    expect(rows).not.toContain(RSC_FRAME_ATTR);
    expect(rows).not.toContain("<html");
  });

  it("omits RSC frames for ordinary isomorphic routes", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/about"),
    );
    const html = await response.text();
    expect(html).toContain(`<script id="${RSC_SEGMENTS_SCRIPT_ID}"`);
    expect(html).toContain("[]");
    expect(html).not.toContain(RSC_FRAME_ATTR);
  });

  it("sends the document bootstrap before a slow RSC segment completes", async () => {
    const pending = deferred<string>();
    const slowRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "root-layout" }, createElement(Outlet)),
      }),
      createFileRoute("/slow")({
        server: true,
        component: () =>
          createElement("section", null, readPromise(pending.promise)),
      }),
    ];
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      routes: slowRoutes,
    });

    const response = await handler(new Request("http://localhost/slow"));
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected response body.");

    const decoder = new TextDecoder();
    const firstText = await readUntil(reader, decoder, RSC_SEGMENTS_SCRIPT_ID);

    expect(firstText).toContain(`${RSC_SLOT_ATTR}="/slow"></div>`);
    expect(firstText).toContain(RSC_SEGMENTS_SCRIPT_ID);
    expect(firstText).not.toContain("slow ready");

    pending.resolve("slow ready");
    const rest = await readRemaining(reader, decoder);
    expect(rest).toContain("slow ready");
  });

  it("logs streamed RSC render errors", async () => {
    const errorRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "root-layout" }, createElement(Outlet)),
      }),
      createFileRoute("/broken")({
        server: true,
        component: () => {
          throw new Error("rsc exploded");
        },
      }),
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
      expect(html).toContain(RSC_FRAME_ATTR);
      expect(html).toContain("rsc exploded");
    } finally {
      console.error = previousError;
    }

    expect(messages.some((message) => message.includes("rsc exploded"))).toBe(
      true,
    );
  });

  it("builds the data context once per server-route request", async () => {
    let calls = 0;
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      context: () => ({ allow: true }),
      dataContext: () => {
        calls += 1;
        return {};
      },
      routes,
    });
    await handler(new Request("http://localhost/dashboard"));
    // One context shared by the RSC render and the document render.
    expect(calls).toBe(1);
  });

  it("detects client references in an RSC payload", () => {
    expect(hasClientReferences('{"tag":"client","value":{"id":"x"}}')).toBe(
      true,
    );
    expect(hasClientReferences('{"tag":"model","value":null}')).toBe(false);
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
