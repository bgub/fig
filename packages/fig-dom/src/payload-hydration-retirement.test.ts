import { createDataStore, dataResource } from "@bgub/fig";
import { jsonPayloadCodec } from "@bgub/fig/internal";
import { expect, it } from "vitest";
import { createPayloadComponent } from "./payload-component.ts";
import { deferred } from "./test-utils.ts";

it("stops a Payload data batch when an abort listener retires its generation", async () => {
  const store = createDataStore();
  const cancelled = deferred<void>();
  const signals: AbortSignal[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      cancelled.resolve();
    },
  });
  const Page = createPayloadComponent<{ id: string }>({
    key: ["page"],
    load: (_props, { signal }) => {
      signals.push(signal);
      return { stream, contentType: jsonPayloadCodec.contentType };
    },
  });
  const props = { id: "one" };
  const child = dataResource({
    key: () => ["child"],
    load: ({ signal }) => {
      signal.addEventListener(
        "abort",
        () => {
          store.hydrate([
            { key: Page.key(props), value: "new page" },
            { key: ["tail"], value: "new data" },
          ]);
        },
        { once: true },
      );
      return "old child";
    },
  });

  try {
    const pending = store.refreshData(Page, props);
    controller.enqueue(
      jsonPayloadCodec.encodeRow({ tag: "model", id: 0, value: "old page" }),
    );
    await expect(pending).resolves.toEqual({
      status: "fulfilled",
      value: "old page",
    });
    await store.refreshData(child);
    controller.enqueue(
      jsonPayloadCodec.encodeRow({
        tag: "data",
        value: [
          { key: ["accepted"], value: "before retirement" },
          { key: ["child"], value: "server child" },
          { key: ["tail"], value: "old data" },
        ],
      }),
    );
    await cancelled.promise;
    expect(signals[0]?.aborted).toBe(true);
    await expect(store.ensureData(Page, props)).resolves.toBe("new page");
    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        { key: ["accepted"], value: "before retirement" },
        { key: ["child"], value: "server child" },
        { key: ["tail"], value: "new data" },
      ]),
    );
  } finally {
    store.dispose();
  }
});
