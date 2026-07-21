import {
  assets,
  createDataStore,
  createElement,
  isValidElement,
  readPromise,
  stylesheet,
  Suspense,
} from "@bgub/fig";
import { renderToDocumentStream } from "@bgub/fig-server";
import { describe, expect, it } from "vitest";
import {
  injectPayloadDocument,
  registerPayloadResponse,
  serializableStartData,
} from "./payload-internal.ts";
import { payloadResource } from "./payload.ts";
import { renderPayloadResponse } from "./server.tsx";
import { runWithStartContext } from "./storage-context.ts";

describe("TanStack Start server payload resources", () => {
  it("registers initial payloads instead of serializing element values", async () => {
    const resource = payloadResource<string>({
      key: (id) => ["payload-profile", id],
      request: (id, { signal }) =>
        renderPayloadResponse(
          createElement("main", { "data-profile": id }, `profile-${id}`),
          { signal },
        ),
    });

    await runWithStartContext({}, async () => {
      const store = createDataStore();
      const node = await store.ensureData(resource, "ada");
      expect(isValidElement(node)).toBe(true);
      expect(serializableStartData(store.snapshot())).toEqual([]);
    });
  });

  it("retains payload assets for the document render", async () => {
    const resource = payloadResource<void>({
      key: () => ["payload-assets"],
      request: (_input, { signal }) =>
        runWithStartContext({}, () =>
          renderPayloadResponse(
            assets(
              stylesheet("/payload.css", { precedence: "payload" }),
              createElement("main", null, "styled"),
            ),
            { signal },
          ),
        ),
    });

    await runWithStartContext({}, async () => {
      const node = await createDataStore().ensureData(resource, undefined);
      const render = renderToDocumentStream(
        createElement(
          "html",
          null,
          createElement("head"),
          createElement(
            "body",
            null,
            assets(stylesheet("/payload.css", { precedence: "payload" }), node),
          ),
        ),
      );
      await render.shellReady;
      const html = await readStream(render.stream);
      expect(html).toContain('rel="stylesheet" href="/payload.css"');
      expect(html.match(/href="\/payload\.css"/g)).toHaveLength(1);
      expect(html.indexOf('href="/payload.css"')).toBeLessThan(
        html.indexOf("styled"),
      );
    });
  });

  it("delivers the initial payload before TanStack starts hydration", async () => {
    const resource = payloadResource<void>({
      key: () => ["ordering"],
      request: (_input, { signal }) =>
        renderPayloadResponse(createElement("main", null, "ready"), {
          signal,
        }),
    });

    await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, undefined);
      const html = await readStream(
        injectPayloadDocument(
          streamFromString(
            '<html><body><main>shell</main><script id="$tsr-stream-barrier"></script></body></html>',
          ),
          undefined,
        ),
      );

      expect(html.indexOf("data-fig-tanstack-payload-key")).toBeLessThan(
        html.indexOf("$tsr-stream-barrier"),
      );
      expect(html).toContain("ready");
    });
  });

  it("streams the shell while payload holes hold hydration", async () => {
    let resolveGreeting = (_value: string): void => undefined;
    const greeting = new Promise<string>((resolve) => {
      resolveGreeting = resolve;
    });
    const resource = payloadResource<void>({
      key: () => ["streaming-payload"],
      request: (_input, { signal }) =>
        renderPayloadResponse(
          createElement(
            Suspense,
            { fallback: createElement("p", null, "pending") },
            createElement(Greeting),
          ),
          { signal },
        ),
    });

    await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, undefined);
      const stream = injectPayloadDocument(
        streamFromString(
          '<html><body><main>shell</main><script id="$tsr-stream-barrier"></script></body></html>',
        ),
        undefined,
      );
      const reader = stream.getReader();
      const shell = await readUntil(reader, "shell");

      expect(shell).not.toContain("data-fig-tanstack-payload-key");
      expect(shell).not.toContain("$tsr-stream-barrier");
      resolveGreeting("streamed-ready");
      const html = shell + (await readReader(reader));
      expect(html).toContain("streamed-ready");
      expect(html.indexOf("streamed-ready")).toBeLessThan(
        html.indexOf("$tsr-stream-barrier"),
      );
    });

    function Greeting() {
      return createElement("p", null, readPromise(greeting));
    }
  });

  it("embeds multiple registered payload resources before hydration", async () => {
    const first = payloadResource<void>({
      key: () => ["multiple", "first"],
      request: (_input, { signal }) =>
        renderPayloadResponse(createElement("p", null, "first-payload"), {
          signal,
        }),
    });
    const second = payloadResource<void>({
      key: () => ["multiple", "second"],
      request: (_input, { signal }) =>
        renderPayloadResponse(createElement("p", null, "second-payload"), {
          signal,
        }),
    });

    await runWithStartContext({}, async () => {
      const store = createDataStore();
      await Promise.all([
        store.ensureData(first, undefined),
        store.ensureData(second, undefined),
      ]);

      expect(serializableStartData(store.snapshot())).toEqual([]);
      const html = await readStream(
        injectPayloadDocument(
          streamFromString(
            '<html><body><script id="$tsr-stream-barrier"></script></body></html>',
          ),
          "nonce-1",
        ),
      );
      expect(html.match(/data-fig-tanstack-payload-key/g)).toHaveLength(2);
      expect(html.match(/nonce="nonce-1"/g)).toHaveLength(2);
      expect(html).toContain("first-payload");
      expect(html).toContain("second-payload");
    });
  });

  it("embeds a payload registered after the document shell starts", async () => {
    await runWithStartContext({}, async () => {
      let markReady = (): void => undefined;
      const ready = new Promise<void>((resolve) => {
        markReady = resolve;
      });
      const document = injectPayloadDocument(
        streamFromString(
          '<html><body><main>shell</main><script id="$tsr-stream-barrier"></script></body></html>',
        ),
        undefined,
        ready,
      );
      const htmlPromise = readStream(document);
      await Promise.resolve();
      registerPayloadResponse(
        ["late-payload"],
        renderPayloadResponse(createElement("p", null, "late-ready")),
      );
      markReady();

      const html = await htmlPromise;

      expect(html).toContain("late-ready");
      expect(html.indexOf("late-ready")).toBeLessThan(
        html.indexOf("$tsr-stream-barrier"),
      );
    });
  });

  it("errors the document stream when a registered payload stream fails", async () => {
    await runWithStartContext({}, async () => {
      registerPayloadResponse(
        ["failed-payload"],
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("payload transport failed"));
            },
          }),
          { headers: { "content-type": "text/x-component" } },
        ),
      );

      await expect(
        readStream(
          injectPayloadDocument(
            streamFromString(
              '<html><body><script id="$tsr-stream-barrier"></script></body></html>',
            ),
            undefined,
          ),
        ),
      ).rejects.toThrow("payload transport failed");
    });
  });

  it("cancels registered payload collection with the document", async () => {
    let htmlCancelled = false;
    let payloadCancelled = false;

    await runWithStartContext({}, async () => {
      const decodeResponse = registerPayloadResponse(
        ["cancelled-payload"],
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              payloadCancelled = true;
            },
          }),
          { headers: { "content-type": "text/x-component" } },
        ),
      );
      const document = injectPayloadDocument(
        new ReadableStream<Uint8Array>({
          cancel() {
            htmlCancelled = true;
          },
        }),
        undefined,
      );

      await Promise.all([
        document.cancel("document cancelled"),
        decodeResponse.body?.cancel("decode cancelled"),
      ]);
    });

    expect(htmlCancelled).toBe(true);
    expect(payloadCancelled).toBe(true);
  });
});

function streamFromString(value: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return readReader(stream.getReader());
}

async function readReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    result += decoder.decode(value, { stream: true });
  }
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  text: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let result = "";
  while (!result.includes(text)) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    result += decoder.decode(value, { stream: true });
  }
  return result;
}
