import { dataResource, type FigNode, readData, Suspense } from "@bgub/fig";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  HeadContent,
  Outlet,
  type RouteDataContext,
} from "@bgub/fig-tanstack-router";
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server";
import { describe, expect, it } from "vitest";
import { createStartDataContext, StartScripts } from "./data.ts";
import { renderRouterToStream } from "./server.tsx";

describe("TanStack Start progressive streaming", () => {
  it("reveals a fast boundary with its data before a slow boundary settles", async () => {
    const fast = controlled<string>();
    const slow = controlled<string>();
    const fastResource = dataResource<[], string>({
      key: () => ["stream-fast"],
      load: () => fast.promise,
    });
    const slowResource = dataResource<[], string>({
      key: () => ["stream-slow"],
      load: () => slow.promise,
    });

    function Fast() {
      return <p id="fast">{readData(fastResource)}</p>;
    }
    function Slow() {
      return <p id="slow">{readData(slowResource)}</p>;
    }

    const rootRoute = createRootRouteWithContext<RouteDataContext>()({
      component: Document,
    });
    const pageRoute = createRoute({
      component: () => (
        <main>
          <Suspense fallback={<p>fast-pending</p>}>
            <Fast />
          </Suspense>
          <Suspense fallback={<p>slow-pending</p>}>
            <Slow />
          </Suspense>
        </main>
      ),
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const router = createRouter({
      ...createStartDataContext(),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([pageRoute]),
      ssr: { nonce: "stream-nonce" },
    });
    await router.load();
    attachRouterServerSsrUtils({ router, manifest: undefined });
    await router.serverSsr?.dehydrate();
    const result = await renderRouterToStream({
      request: new Request("https://example.test/"),
      responseHeaders: new Headers(),
      router,
    });
    const reader = result.response.body!.getReader();
    const decoder = new TextDecoder();
    let html = "";

    try {
      // The router bootstrap is not held behind pending boundaries, so the
      // client can hydrate the shell while both are still loading.
      const bootstrap = "/*$tsr-stream-boundary*/";
      while (!html.includes(bootstrap)) html += await readChunk();
      expect(html).toContain("fast-pending");
      expect(html).not.toContain("fast-value");

      fast.resolve("fast-value");
      while (revealIndex(html, 'id="fast"') === -1) html += await readChunk();

      expect(html).not.toContain("slow-value");
      // The rows trail the hidden staged content but precede its reveal.
      const fastRecord = dataOperationIndex(html, "fast-value");
      expect(fastRecord).toBeGreaterThan(html.indexOf('id="fast"'));
      expect(fastRecord).toBeLessThan(revealIndex(html, 'id="fast"'));

      slow.resolve("slow-value");
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        html += decoder.decode(part.value, { stream: true });
      }
      html += decoder.decode();

      const slowRecord = dataOperationIndex(html, "slow-value");
      expect(slowRecord).toBeGreaterThan(html.indexOf('id="slow"'));
      expect(slowRecord).toBeLessThan(revealIndex(html, 'id="slow"'));
      for (const match of html.matchAll(/<script([^>]*)>([^<]*)<\/script>/g)) {
        if (match[2]?.includes(".d(")) {
          expect(match[1]).toContain('nonce="stream-nonce"');
        }
      }
    } finally {
      fast.resolve("fast-value");
      slow.resolve("slow-value");
      await reader.cancel();
    }

    async function readChunk(): Promise<string> {
      const part = await reader.read();
      if (part.done) throw new Error("The document ended early.");
      return decoder.decode(part.value, { stream: true });
    }
  });
});

// Index of the first boundary reveal after the staged `content`.
function revealIndex(html: string, content: string): number {
  const staged = html.indexOf(content);
  return staged === -1 ? -1 : html.indexOf(".c(", staged);
}

// Index of the renderer's data operation carrying `value`.
function dataOperationIndex(html: string, value: string): number {
  for (const match of html.matchAll(/<script[^>]*>([^<]*)<\/script>/g)) {
    const source = match[1] ?? "";
    if (source.includes(".d(") && source.includes(value)) return match.index;
  }
  return -1;
}

function controlled<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
