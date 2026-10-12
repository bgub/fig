import { describe, expect, it, vi } from "vitest";
import { createElement, dataResource, readData } from "@bgub/fig";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { createPayloadComponent, createRoot, flushSync } from "./index.ts";
import { deferred, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

function response(value: string, dataPartition?: string): Response {
  const result = renderToPayloadStream(value, { dataPartition });
  return new Response(result.stream, {
    headers: { "content-type": result.contentType },
  });
}

describe("root data partitions", () => {
  it("rejects foreign hydration before the lazy store is installed", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      dataPartition: "alice",
    });
    try {
      expect(() =>
        root.data.hydrate([{ key: ["user"], value: "Bob", partition: "bob" }]),
      ).toThrow("Data partition mismatch");
      root.data.hydrate([
        { key: ["user"], value: "Alice", partition: "alice" },
      ]);
      const user = dataResource<[], string>({ key: () => ["user"] });
      flushSync(() => root.render(createElement(() => readData(user))));
      expect(container.textContent).toBe("Alice");
    } finally {
      root.unmount();
    }
  });

  it("captures the root partition before lazy store installation", async () => {
    const partition = { user: "alice" };
    const root = createRoot(new FakeElement("root") as unknown as Element, {
      dataPartition: partition,
    });
    partition.user = "bob";
    try {
      root.data.hydrate([
        { key: ["user"], value: "Alice", partition: { user: "alice" } },
      ]);
      const user = dataResource<[], string>({ key: () => ["user"] });
      expect(await root.data.ensureData(user)).toBe("Alice");
    } finally {
      root.unmount();
    }
  });

  it.each(["bob", undefined])(
    "rejects a Payload component response from partition %j",
    async (partition) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const root = createRoot(new FakeElement("root") as unknown as Element, {
        dataPartition: "alice",
      });
      const Page = createPayloadComponent<{}>({
        key: ["page"],
        load: () => response("foreign", partition),
      });
      try {
        const result = await root.data.refreshData(Page, {});
        expect(result).toMatchObject({
          status: "rejected",
          error: expect.objectContaining({
            message: expect.stringContaining("Data partition mismatch"),
          }),
        });
      } finally {
        root.unmount();
        consoleError.mockRestore();
      }
    },
  );

  it("retires the old account's pending Payload before a replacement root loads the same key", async () => {
    const container = new FakeElement("root");
    const pending = deferred<Response>();
    let calls = 0;
    let oldSignal: AbortSignal | undefined;
    const Page = createPayloadComponent<{}>({
      key: ["page"],
      load: (_props, context) => {
        if (++calls === 1) {
          oldSignal = context.signal;
          return pending.promise;
        }
        return response("Bob", "bob");
      },
    });
    const alice = createRoot(container as unknown as Element, {
      dataPartition: "alice",
    });
    const oldLoad = alice.data.refreshData(Page, {});
    alice.unmount();
    expect(oldSignal?.aborted).toBe(true);
    const bob = createRoot(container as unknown as Element, {
      dataPartition: "bob",
    });
    try {
      await expect(bob.data.refreshData(Page, {})).resolves.toMatchObject({
        status: "fulfilled",
        value: "Bob",
      });
      pending.resolve(response("Alice", "alice"));
      await expect(oldLoad).resolves.toMatchObject({
        status: "aborted",
        reason: "store-disposed",
      });
      await expect(bob.data.ensureData(Page, {})).resolves.toBe("Bob");
      flushSync(() => bob.render(createElement(Page, {})));
      expect(container.textContent).toBe("Bob");
    } finally {
      bob.unmount();
    }
  });
});
