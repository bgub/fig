import { renderToStream } from "@bgub/fig-server";
import { describe, expect, it } from "vite-plus/test";
import {
  App,
  type DemoRequest,
  demoRootId,
  streamIdentifierPrefix,
} from "./app.tsx";
import { serverInfoResource, serverOnlyInfoResource } from "./data.server.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

function renderDemo(request: DemoRequest) {
  return renderToStream(
    <div id={demoRootId}>
      <App
        request={request}
        serverInfoResource={serverInfoResource}
        serverOnlyInfoResource={serverOnlyInfoResource}
      />
    </div>,
    { identifierPrefix: streamIdentifierPrefix },
  );
}

function demoRequest(
  suspense: DemoRequest["resources"]["suspense"],
  abortDelay: number | null = null,
): DemoRequest {
  return {
    abortDelay,
    resources: {
      broken: "Server error panel ready.",
      suspense,
      hidden: "Hidden activity panel ready.",
      hiddenBroken: "Hidden activity error panel ready.",
    },
    startedAt: "test",
  };
}

describe("streaming SSR demo", () => {
  it("flushes an interactive shell while Suspense is pending", async () => {
    const render = renderDemo(
      demoRequest(new Promise<string>(() => undefined)),
    );
    await render.shellReady;
    render.abort("test complete");
    await render.allReady;

    const html = await readStream(render.stream);

    expect(html).toContain("Shell clicks: 0");
    expect(html).toContain("Pending fallback for 5 seconds.");
    expect(html).toContain("<!--fig:suspense:pending:0-->");
    expect(html).not.toContain("Suspense clicks: 0");
  });

  it("streams completed Suspense content after the shell", async () => {
    const suspense = deferred<string>();

    const render = renderDemo(demoRequest(suspense.promise));
    await render.shellReady;
    suspense.resolve("Content resolved.");
    await render.allReady;

    const html = await readStream(render.stream);

    expect(html).toContain("Pending fallback for 5 seconds.");
    expect(html).toContain("Content resolved.");
    expect(html).toContain(`__figSSR.c("${streamIdentifierPrefix}-b-0"`);
  });

  it("marks pending Suspense for client rendering after abort", async () => {
    const render = renderDemo(
      demoRequest(new Promise<string>(() => undefined), 1),
    );
    await render.shellReady;
    render.abort("test abort");
    await render.allReady;

    const html = await readStream(render.stream);

    expect(html).toContain("Pending fallback for 5 seconds.");
    expect(html).toContain(`__figSSR.x("${streamIdentifierPrefix}-b-0"`);
    expect(html).not.toContain(`__figSSR.c("${streamIdentifierPrefix}-b-0"`);
  });
});
