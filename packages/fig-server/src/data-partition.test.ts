import { describe, expect, it, vi } from "vitest";
import {
  assets,
  clientReference,
  createDataStore,
  createElement,
  dataResource,
  readData,
  stylesheet,
} from "@bgub/fig";
import { jsonPayloadCodec, type PayloadRow } from "@bgub/fig/internal";
import { decodePayloadStream } from "@bgub/fig/payload";
import { prerender } from "./index.ts";
import { renderToPayloadStream } from "./payload.ts";

function together(rows: PayloadRow[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
        ),
      );
      controller.close();
    },
  });
}

describe("server data partitions", () => {
  it("preserves partitions through HTML snapshots and matching client hydration", async () => {
    const user = dataResource({ key: () => ["user"], load: () => "Alice" });
    const result = await prerender(
      createElement(() => readData(user)),
      { dataPartition: "alice" },
    );
    expect(result.data).toEqual([
      { key: ["user"], value: "Alice", partition: "alice" },
    ]);
    const client = createDataStore({
      partition: "alice",
      initialData: result.data,
    });
    try {
      expect(await client.ensureData(user)).toBe("Alice");
      expect(() =>
        createDataStore({ partition: "bob", initialData: result.data }),
      ).toThrow("Data partition mismatch");
    } finally {
      client.dispose();
    }
  });

  it("retains partitions in Payload data rows and accepts equivalent partition objects", async () => {
    const user = dataResource({ key: () => ["user"], load: () => "Alice" });
    const result = renderToPayloadStream(
      createElement(() => readData(user)),
      {
        dataPartition: { user: "alice", revision: 1 },
      },
    );
    const client = createDataStore({
      partition: { revision: 1, user: "alice" },
    });
    try {
      await expect(
        decodePayloadStream(result.stream, {
          dataPartition: { revision: 1, user: "alice" },
          hydrate: (entries) => client.hydrate(entries),
        }),
      ).resolves.toBe("Alice");
      expect(client.snapshot()).toEqual([
        {
          key: ["user"],
          value: "Alice",
          partition: { revision: 1, user: "alice" },
        },
      ]);
    } finally {
      client.dispose();
    }
  });

  it.each([undefined, "bob"])(
    "rejects a private tree without data rows for partition %j",
    async (dataPartition) => {
      const prepareAssets = vi.fn();
      const resolveClientReference = vi.fn();
      const hydrate = vi.fn();
      const result = renderToPayloadStream(
        assets(
          stylesheet("/alice.css"),
          createElement(clientReference({ id: "alice-island" })),
        ),
        { dataPartition: "alice" },
      );
      await expect(
        decodePayloadStream(result.stream, {
          dataPartition,
          hydrate,
          prepareAssets,
          resolveClientReference,
        }),
      ).rejects.toThrow("Data partition mismatch");
      expect(prepareAssets).not.toHaveBeenCalled();
      expect(resolveClientReference).not.toHaveBeenCalled();
      expect(hydrate).not.toHaveBeenCalled();
    },
  );

  it("rejects unlabelled streams in a partitioned decoder", async () => {
    const result = renderToPayloadStream("unlabelled");
    await expect(
      decodePayloadStream(result.stream, { dataPartition: "alice" }),
    ).rejects.toThrow("Data partition mismatch");
  });

  it("cannot publish later rows in the same byte chunk after a partition mismatch", async () => {
    const prepareAssets = vi.fn();
    const rows: PayloadRow[] = [
      { tag: "partition", value: "bob" },
      { tag: "assets", value: [{ kind: "stylesheet", href: "/bob.css" }] },
      { tag: "model", id: 0, value: "Bob" },
    ];
    await expect(
      decodePayloadStream(together(rows), {
        dataPartition: "alice",
        prepareAssets,
      }),
    ).rejects.toThrow("Data partition mismatch");
    expect(prepareAssets).not.toHaveBeenCalled();
  });

  it.each([undefined, "bob"])(
    "rejects data rows labelled %j inside an Alice stream, even without a hydration callback",
    async (partition) => {
      await expect(
        decodePayloadStream(
          together([
            { tag: "partition", value: "alice" },
            {
              tag: "data",
              value: [{ key: ["user"], value: "Bob", partition }],
            },
            { tag: "model", id: 0, value: "Bob" },
          ]),
          { dataPartition: "alice" },
        ),
      ).rejects.toThrow("Data partition mismatch");
    },
  );

  it("rejects a repeated partition declaration before publishing the root", async () => {
    await expect(
      decodePayloadStream(
        together([
          { tag: "partition", value: "alice" },
          { tag: "partition", value: "alice" },
          { tag: "model", id: 0, value: "Alice" },
        ]),
        { dataPartition: "alice" },
      ),
    ).rejects.toThrow("Payload partition must be declared once");
  });

  it("declares the captured partition before all content even when options mutate", async () => {
    const partition = { user: "alice" };
    const result = renderToPayloadStream("Alice", { dataPartition: partition });
    partition.user = "bob";
    const text = await new Response(result.stream).text();
    expect(text.split("\n")[0]).toBe(
      new TextDecoder()
        .decode(
          jsonPayloadCodec.encodeRow({
            tag: "partition",
            value: { user: "alice" },
          }),
        )
        .trim(),
    );
  });
});
