import {
  assets,
  createDataStore,
  type DataResourceKey,
  type FigNode,
  isValidElement,
  readPromise,
  stylesheet,
  Suspense,
} from "@bgub/fig";
import {
  decodePayloadDataEntries,
  type PayloadDataHydrationEntry,
} from "@bgub/fig/internal";
import {
  createPayloadComponent,
  type PayloadComponentLoader,
} from "@bgub/fig-dom";
import { renderToDocumentStream } from "@bgub/fig-server";
import { describe, expect, it } from "vitest";
import { payloadTransportMarkerId } from "./document-markers.ts";
import {
  injectPayloadDocument,
  payloadDataFilter,
  registerPayloadResponse,
} from "./payload-internal.ts";
import { serverPayload } from "./payload.ts";
import { renderPayloadResponse } from "./server.tsx";
import { runWithStartContext } from "./storage-context.ts";
import { startStreamGlobal } from "./document-stream.ts";
import { startDataDocumentScript, startDataScriptId } from "./transport.ts";

describe("TanStack Start server payload resources", () => {
  it("registers initial payloads instead of serializing element values", async () => {
    const resource = compiledPayloadComponent<{ id: string }>({
      key: ["payload-profile"],
      request: ({ id }, { signal }) =>
        renderPayloadResponse(<main data-profile={id}>profile-{id}</main>, {
          signal,
        }),
    });

    await runWithStartContext({}, async () => {
      const store = createDataStore();
      const node = await store.ensureData(resource, { id: "ada" });
      expect(isValidElement(node)).toBe(true);
      const html = await readStream(
        injectPayloadDocument(
          streamFromString(payloadDocument()),
          undefined,
          () => snapshotScript(store),
        ),
      );
      expect(documentData(html)).toEqual([]);
    });
  });

  it("retains payload assets for the document render", async () => {
    const resource = compiledPayloadComponent<Record<string, never>>({
      key: ["payload-assets"],
      request: (_props, { signal }) =>
        runWithStartContext({}, () =>
          renderPayloadResponse(
            assets(
              stylesheet("/payload.css", { precedence: "payload" }),
              <main>styled</main>,
            ),
            { signal },
          ),
        ),
    });

    await runWithStartContext({}, async () => {
      const node = await createDataStore().ensureData(resource, {});
      const render = renderToDocumentStream(
        <html>
          <head />
          <body>
            {assets(
              stylesheet("/payload.css", { precedence: "payload" }),
              node,
            )}
          </body>
        </html>,
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
    const resource = compiledPayloadComponent<Record<string, never>>({
      key: ["ordering"],
      request: (_props, { signal }) =>
        renderPayloadResponse(<main>ready</main>, {
          signal,
        }),
    });

    await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, {});
      const html = await readStream(
        injectPayloadDocument(
          streamFromString(payloadDocument("<main>shell</main>")),
          undefined,
        ),
      );

      expect(html.indexOf(startStreamGlobal)).toBeLessThan(
        html.indexOf(payloadTransportMarkerId),
      );
      expect(html).toContain("ready");
    });
  });

  it("aborts payload renders with the request signal from the Start context", async () => {
    const pending = new Promise<string>(() => undefined);
    const controller = new AbortController();
    const request = new Request("http://localhost/_serverFn/payload", {
      signal: controller.signal,
    });

    function Slow() {
      return <p>{readPromise(pending)}</p>;
    }

    const response = await runWithStartContext({ request }, () =>
      renderPayloadResponse(
        <Suspense fallback={<p>pending</p>}>
          <Slow />
        </Suspense>,
      ),
    );
    if (response.body === null) throw new Error("Expected a payload body.");
    const read = readStream(response.body);
    read.catch(() => undefined);

    controller.abort(new Error("request closed"));

    await expect(read).rejects.toThrow("request closed");
  });

  it("streams payload holes after the hydration bootstrap", async () => {
    let resolveGreeting = (_value: string): void => undefined;
    const greeting = new Promise<string>((resolve) => {
      resolveGreeting = resolve;
    });
    const resource = compiledPayloadComponent<Record<string, never>>({
      key: ["streaming-payload"],
      request: (_props, { signal }) =>
        renderPayloadResponse(
          <Suspense fallback={<p>pending</p>}>
            <Greeting />
          </Suspense>,
          { signal },
        ),
    });

    await runWithStartContext({}, async () => {
      await createDataStore().ensureData(resource, {});
      const stream = injectPayloadDocument(
        streamFromString(payloadDocument("<main>shell</main>")),
        undefined,
      );
      const reader = stream.getReader();
      const shell = await readUntil(reader, payloadTransportMarkerId);

      expect(shell).toContain(startStreamGlobal);
      expect(shell).toContain("pending");
      expect(shell).not.toContain("streamed-ready");
      resolveGreeting("streamed-ready");
      const html = shell + (await readReader(reader));
      expect(html.indexOf("streamed-ready")).toBeGreaterThan(
        html.indexOf(payloadTransportMarkerId),
      );
    });

    function Greeting() {
      return <p>{readPromise(greeting)}</p>;
    }
  });

  it("embeds multiple registered payload resources before hydration", async () => {
    const first = compiledPayloadComponent<Record<string, never>>({
      key: ["multiple", "first"],
      request: (_props, { signal }) =>
        renderPayloadResponse(<p>first-payload</p>, {
          signal,
        }),
    });
    const second = compiledPayloadComponent<Record<string, never>>({
      key: ["multiple", "second"],
      request: (_props, { signal }) =>
        renderPayloadResponse(<p>second-payload</p>, {
          signal,
        }),
    });

    await runWithStartContext({}, async () => {
      const store = createDataStore();
      await Promise.all([
        store.ensureData(first, {}),
        store.ensureData(second, {}),
      ]);

      const html = await readStream(
        injectPayloadDocument(
          streamFromString(payloadDocument()),
          "nonce-1",
          () => snapshotScript(store),
        ),
      );
      expect(documentData(html)).toEqual([]);
      const records = streamScripts(html);
      expect(records.length).toBeGreaterThan(0);
      for (const script of records) {
        expect(script.attributes).toContain('nonce="nonce-1"');
      }
      expect(html).toContain("first-payload");
      expect(html).toContain("second-payload");
    });
  });

  it("filters payload-backed values from the late Fig data snapshot", async () => {
    await runWithStartContext({}, async () => {
      const store = createDataStore();
      store.hydrate([
        { key: ["document-data"], value: "document-value" },
        { key: ["payload-data"], value: "duplicated-value" },
      ]);
      const decoded = registerPayloadResponse(
        ["payload-data"],
        new Response("payload-value", {
          headers: { "content-type": "text/plain" },
        }),
      ).text();

      const html = await readStream(
        injectPayloadDocument(
          streamFromString(payloadDocument()),
          undefined,
          () => snapshotScript(store),
        ),
      );
      expect(documentData(html)).toEqual([
        { key: ["document-data"], value: "document-value" },
      ]);
      expect(html).toContain('"payload-value"');
      await decoded;
    });
  });

  it("injects across a split marker without rewriting document bytes", async () => {
    await runWithStartContext({}, async () => {
      registerPayloadResponse(
        ["split-marker"],
        new Response(streamFromString("payload"), {
          headers: { "content-type": "text/plain" },
        }),
      );
      const source = payloadDocument("<main>café 🙂</main>");
      const markerStart = source.indexOf(
        `<template id="${payloadTransportMarkerId}`,
      );
      const split = new TextEncoder().encode(
        source.slice(0, markerStart + 7),
      ).byteLength;
      const bytes = new TextEncoder().encode(source);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, split));
          controller.enqueue(bytes.subarray(split));
          controller.close();
        },
      });

      const html = await readStream(injectPayloadDocument(stream, undefined));

      expect(html).toContain("<main>café 🙂</main>");
      expect(html).toContain('"payload"');
      expect(html.indexOf('"payload"')).toBeLessThan(
        html.indexOf(payloadTransportMarkerId),
      );
    });
  });

  it("streams a payload registered after the marker", async () => {
    await runWithStartContext({}, async () => {
      let finishHtml = (): void => undefined;
      const htmlDone = new Promise<void>((resolve) => {
        finishHtml = resolve;
      });
      const bytes = new TextEncoder().encode(
        payloadDocument("<main>shell</main>"),
      );
      const document = injectPayloadDocument(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(bytes);
            await htmlDone;
            controller.enqueue(new TextEncoder().encode("<p>after</p>"));
            controller.close();
          },
        }),
        undefined,
      );
      const reader = document.getReader();
      const shell = await readUntil(reader, payloadTransportMarkerId);
      // As in a render, the boundary completes only after decoding.
      await registerPayloadResponse(
        ["late-payload"],
        renderPayloadResponse(<p>late-ready</p>),
      ).text();
      finishHtml();

      const html = shell + (await readReader(reader));

      expect(shell).not.toContain("late-ready");
      expect(html.indexOf("late-ready")).toBeLessThan(html.indexOf("after"));
    });
  });

  it("streams each payload's records as they arrive, independent of HTML and other payloads", async () => {
    await runWithStartContext({}, async () => {
      const fast = controlledStream();
      const slow = controlledStream();
      registerPayloadResponse(["fast-payload"], textResponse(fast.stream));
      registerPayloadResponse(["slow-payload"], textResponse(slow.stream));
      const html = controlledStream();
      html.push(payloadDocument("<main>shell</main>"));
      const reader = injectPayloadDocument(html.stream, undefined).getReader();
      await readUntil(reader, payloadTransportMarkerId);

      // HTML is idle and the slow payload is open.
      fast.push("fast-bytes");
      expect(await nextText(reader)).toContain(
        String.raw`["p","[\"fast-payload\"]","fast-bytes"]`,
      );

      // HTML has ended; the fast payload's end does not wait for the slow one.
      html.close();
      fast.close();
      expect(await nextText(reader)).toContain(
        String.raw`["e","[\"fast-payload\"]"]`,
      );

      slow.push("slow-bytes");
      slow.close();
      const rest = await readReader(reader);
      expect(rest).toContain(
        String.raw`["p","[\"slow-payload\"]","slow-bytes"]`,
      );
      expect(rest).toContain(String.raw`["e","[\"slow-payload\"]"]`);
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
          injectPayloadDocument(streamFromString(payloadDocument()), undefined),
        ),
      ).rejects.toThrow("payload transport failed");
    });
  });

  it("rejects initial payloads when the root omits StartScripts", async () => {
    await runWithStartContext({}, async () => {
      const decodeResponse = registerPayloadResponse(
        ["missing-start-scripts"],
        new Response(streamFromString("payload"), {
          headers: { "content-type": "text/x-component" },
        }),
      );
      const decoded = decodeResponse.text();

      await expect(
        readStream(
          injectPayloadDocument(
            streamFromString("<html><body></body></html>"),
            undefined,
          ),
        ),
      ).rejects.toThrow(/require <StartScripts \/>/);
      await decoded;
    });
  });

  it("cancels registered payload collection with the document", async () => {
    let htmlCancelled = false;
    let payloadCancelled = false;
    let finishHtmlCancellation = (): void => undefined;
    const htmlCancellation = new Promise<void>((resolve) => {
      finishHtmlCancellation = resolve;
    });

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
          async cancel() {
            htmlCancelled = true;
            await htmlCancellation;
          },
        }),
        undefined,
      );

      let cancellationSettled = false;
      const cancellation = Promise.all([
        document.cancel("document cancelled"),
        decodeResponse.body?.cancel("decode cancelled"),
      ]);
      void cancellation.then(() => {
        cancellationSettled = true;
      });
      await Promise.resolve();

      expect(htmlCancelled).toBe(true);
      expect(payloadCancelled).toBe(true);
      expect(cancellationSettled).toBe(false);

      finishHtmlCancellation();
      await cancellation;
      expect(cancellationSettled).toBe(true);
    });
  });
});

function compiledPayloadComponent<TProps extends object>(options: {
  key: DataResourceKey;
  request: PayloadComponentLoader<TProps>;
}) {
  return createPayloadComponent<TProps>({
    key: options.key,
    load: serverPayload(markCompiled(options.request)),
  });
}

function markCompiled<TProps extends object>(
  request: PayloadComponentLoader<TProps>,
): (props: TProps) => FigNode {
  return Object.assign(request, {
    [Symbol.for("fig.tanstack-start.compiled-server-payload")]: true as const,
  }) as unknown as (props: TProps) => FigNode;
}

function streamFromString(value: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function payloadDocument(body = ""): string {
  return `<html><body>${body}<template id="${payloadTransportMarkerId}"></template></body></html>`;
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

// The next document chunk, failing instead of hanging when the transport
// holds it back.
async function nextText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("The chunk was held back.")),
      500,
    );
  });
  try {
    const { done, value } = await Promise.race([reader.read(), blocked]);
    if (done) throw new Error("The document ended early.");
    return new TextDecoder().decode(value);
  } finally {
    clearTimeout(timer);
  }
}

function controlledStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    close: () => controller.close(),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    stream,
  };
}

function textResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: { "content-type": "text/x-component" },
  });
}

function documentData(html: string) {
  const script = html.match(
    new RegExp(
      `<script[^>]*id="${startDataScriptId}"[^>]*>([\\s\\S]*?)<\\/script>`,
    ),
  )?.[1];
  if (script === undefined) throw new Error("Missing Fig data script.");
  return decodePayloadDataEntries(
    JSON.parse(script) as PayloadDataHydrationEntry[],
  );
}

function streamScripts(html: string) {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((match) => match[2]?.includes(startStreamGlobal))
    .map((match) => ({ attributes: match[1] ?? "", source: match[2] ?? "" }));
}

// Stands in for the renderer's takeData() with the adapter's filter.
function snapshotScript(store: ReturnType<typeof createDataStore>): string {
  return startDataDocumentScript(store.snapshot().filter(payloadDataFilter()));
}
