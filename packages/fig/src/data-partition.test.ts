import { describe, expect, it } from "vitest";
import { createDataStore, dataResource } from "./index.ts";
import type { DataResourceKeyInput, FigDataHydrationEntry } from "./index.ts";
import { loadContextCapabilities } from "./internal.ts";

describe("data partitions", () => {
  it("rejects another user's snapshot without changing the receiving value", async () => {
    const user = dataResource({
      key: () => ["current-user"],
      load: () => "Alice",
    });
    const alice = createDataStore({ partition: "alice" });
    const bob = createDataStore({ partition: "bob" });
    try {
      await alice.ensureData(user);
      await bob.ensureData(dataResource({ key: user.key, load: () => "Bob" }));
      expect(() => bob.hydrate(alice.snapshot())).toThrow(
        "Data partition mismatch",
      );
      expect(await bob.ensureData(user)).toBe("Bob");
    } finally {
      alice.dispose();
      bob.dispose();
    }
  });

  it.each([
    ["alice", undefined],
    [undefined, "alice"],
    [null, undefined],
    ["", undefined],
    ["alice", "bob"],
  ] as const)("rejects hydration across %j and %j", (partition, incoming) => {
    const entry = {
      key: ["user"] as const,
      value: "Alice",
      partition: incoming,
    };
    const store = createDataStore({ partition });
    try {
      expect(() => store.hydrate([entry])).toThrow("Data partition mismatch");
      expect(store.snapshot()).toEqual([]);
      expect(() =>
        createDataStore({ partition, initialData: [entry] }),
      ).toThrow("Data partition mismatch");
    } finally {
      store.dispose();
    }
  });

  it("preserves structural partition equality through encoded snapshots", async () => {
    const definition = { user: "alice", revision: -0 };
    const user = dataResource({ key: () => ["user"], load: () => "Alice" });
    const source = createDataStore({ partition: definition });
    const target = createDataStore({
      partition: { revision: 0, user: "alice" },
    });
    try {
      await source.ensureData(user);
      definition.user = "bob";
      const snapshot = source.snapshot();
      expect(snapshot[0].partition).toEqual({ user: "alice", revision: 0 });
      target.hydrate(JSON.parse(JSON.stringify(snapshot)));
      expect(await target.ensureData(user)).toBe("Alice");
      snapshot[0].partition = "bob";
      expect(source.snapshot()[0].partition).toEqual({
        user: "alice",
        revision: 0,
      });
    } finally {
      source.dispose();
      target.dispose();
    }
  });

  it("rejects a mixed batch before replacing values or aborting their generations", async () => {
    let signal: AbortSignal | undefined;
    const user = dataResource({
      key: () => ["user"],
      load: (context) => {
        signal = context.signal;
        return "original";
      },
    });
    const store = createDataStore({ partition: "alice" });
    try {
      await store.ensureData(user);
      expect(() =>
        store.hydrate([
          { key: ["user"], partition: "alice", value: "replacement" },
          { key: ["other"], partition: "bob", value: "foreign" },
        ]),
      ).toThrow("Data partition mismatch");
      expect(await store.ensureData(user)).toBe("original");
      expect(signal?.aborted).toBe(false);
      expect(store.snapshot()).toHaveLength(1);
    } finally {
      store.dispose();
    }
  });

  it("validates generation hydration before skipping its own key", async () => {
    let hydrate:
      | ((entries: readonly FigDataHydrationEntry[]) => void)
      | undefined;
    let partition: DataResourceKeyInput | undefined;
    const user = dataResource({
      key: () => ["user"],
      load: (context) => {
        const capabilities = loadContextCapabilities(context)!;
        hydrate = capabilities.hydrate;
        partition = capabilities.partition;
        return "Alice";
      },
    });
    const store = createDataStore({ partition: "alice" });
    try {
      await store.ensureData(user);
      expect(partition).toBe("alice");
      expect(() =>
        hydrate!([{ key: ["user"], partition: "bob", value: "Bob" }]),
      ).toThrow("Data partition mismatch");
      expect(await store.ensureData(user)).toBe("Alice");
    } finally {
      store.dispose();
    }
  });
});
