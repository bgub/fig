import {
  createDataStore,
  createElement,
  dataResource,
  readData,
} from "@bgub/fig";
import { decodePayloadStream } from "@bgub/fig/payload";
import { describe, expect, it } from "vitest";
import { prerender, renderToStream } from "./index.ts";
import { renderToPayloadStream } from "./payload.ts";
import { deferred } from "./shared.ts";
import { readStream } from "./test-utils.ts";

describe("@bgub/fig-server data resources", () => {
  it("isolates concurrent requests reading the same resource key", async () => {
    const firstLoad = deferred<string>();
    const secondLoad = deferred<string>();
    const signals: AbortSignal[] = [];
    const bothStarted = deferred<void>();
    const resource = dataResource({
      key: () => ["current-user"],
      load: ({ signal }) => {
        signals.push(signal);
        if (signals.length === 2) bothStarted.resolve(undefined);
        return signals.length === 1 ? firstLoad.promise : secondLoad.promise;
      },
    });

    function Profile() {
      return createElement("span", null, readData(resource));
    }

    const first = renderToStream(createElement(Profile));
    const second = renderToStream(createElement(Profile));
    const firstHtml = readStream(first.stream);
    const secondHtml = readStream(second.stream);

    expect(first.data).not.toBe(second.data);
    await bothStarted.promise;
    expect(signals).toHaveLength(2);

    firstLoad.resolve("Ada");
    expect(await firstHtml).toBe("<span>Ada</span>");
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    expect(second.getData()).toEqual([]);

    secondLoad.resolve("Grace");
    expect(await secondHtml).toBe("<span>Grace</span>");
    expect(first.getData()).toEqual([{ key: ["current-user"], value: "Ada" }]);
    expect(second.getData()).toEqual([
      { key: ["current-user"], value: "Grace" },
    ]);
  });

  it("renders data resources and exposes fulfilled entries", async () => {
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["ssr-user", id],
      load: () => "Ada",
    });

    function Profile() {
      return createElement("span", null, readData(userResource, "one"));
    }

    const result = renderToStream(createElement(Profile, null));

    await result.allReady;

    expect(await readStream(result.stream)).toBe("<span>Ada</span>");
    expect(result.getData()).toEqual([
      { key: ["ssr-user", "one"], value: "Ada" },
    ]);
  });

  it("returns data hydration entries from prerender", async () => {
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["prerender-user", id],
      load: () => "Ada",
    });

    function Profile() {
      return createElement("span", null, readData(userResource, "one"));
    }

    const result = await prerender(createElement(Profile, null));

    expect(result.html).toBe("<span>Ada</span>");
    expect(result.data).toEqual([
      { key: ["prerender-user", "one"], value: "Ada" },
    ]);
  });

  it("hydrates route-loader data before the first render read", async () => {
    let loads = 0;
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["initial-user", id],
      load: () => {
        loads += 1;
        return "network";
      },
    });

    function Profile() {
      return createElement("span", null, readData(userResource, "one"));
    }

    const result = renderToStream(createElement(Profile, null), {
      initialData: [{ key: ["initial-user", "one"], value: "Ada" }],
    });

    await result.allReady;

    expect(await readStream(result.stream)).toBe("<span>Ada</span>");
    expect(result.data).toBeDefined();
    expect(loads).toBe(0);
  });

  it("adopts a store populated before rendering without copying entries", async () => {
    let loads = 0;
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["adopted-user", id],
      load: () => {
        loads += 1;
        return "Ada";
      },
    });
    const dataStore = createDataStore();
    await dataStore.ensureData(userResource, "one");

    function Profile() {
      return createElement("span", null, readData(userResource, "one"));
    }

    const result = renderToStream(createElement(Profile), { dataStore });
    await result.allReady;

    expect(result.data).toBe(dataStore);
    expect(await readStream(result.stream)).toBe("<span>Ada</span>");
    expect(loads).toBe(1);
  });

  it("rejects renderer initialization data with an adopted store", () => {
    const dataStore = createDataStore();

    expect(() => renderToStream(null, { dataStore, initialData: [] })).toThrow(
      "Pass initialData to createDataStore()",
    );

    dataStore.dispose();
  });

  it.each([false, true])(
    "only streams opted-in dependencies in Payload (plain dependency read directly: %s)",
    async (readDependencyDirectly) => {
      const collection = dataResource({
        key: () => ["payload-collection"],
        load: () => ({ rows: ["Ada"] }),
        transfer: (value: { rows: string[] }) => value.rows,
      });
      // Serializable on purpose: omission must come from the dependency rule,
      // not from the wire codec rejecting the value. This plain intermediary
      // must not prevent traversal to the opted-in collection beneath it.
      const serverContext = dataResource({
        key: () => ["payload-server-context"],
        load: async ({ data }) => {
          const { rows } = await data.ensureData(collection);
          return { internalNote: "server-only-computation", name: rows[0] };
        },
      });
      const profile = dataResource({
        key: () => ["payload-derived-profile"],
        load: async ({ data }) => {
          const context = await data.ensureData(serverContext);
          return context.name;
        },
      });
      function Profile() {
        const name = readData(profile);
        // Read after the derived resource to catch traversal marking a plain
        // dependency visited before it is encountered as a direct read.
        if (readDependencyDirectly) readData(serverContext);
        return createElement("span", null, name);
      }

      const result = renderToPayloadStream(createElement(Profile));
      const [textStream, decodeStream] = result.stream.tee();
      const text = await readStream(textStream);
      const hydrated: unknown[] = [];
      const done = deferred<void>();
      void decodePayloadStream(decodeStream, {
        hydrate: (entries) => {
          hydrated.push(...entries);
          return true;
        },
        onStreamDone: () => done.resolve(undefined),
      });
      await done.promise;

      expect(hydrated).toEqual([
        { key: ["payload-collection"], value: ["Ada"] },
        ...(readDependencyDirectly
          ? [
              {
                key: ["payload-server-context"],
                value: { internalNote: "server-only-computation", name: "Ada" },
              },
            ]
          : []),
        { key: ["payload-derived-profile"], value: "Ada" },
      ]);
      expect(text.includes("server-only-computation")).toBe(
        readDependencyDirectly,
      );
      expect(text.indexOf('"tag":"data"')).toBeLessThan(
        text.indexOf('"tag":"model"'),
      );
      // Explicit snapshots retain their existing all-entry behavior.
      const dataStore = createDataStore();
      await dataStore.ensureData(profile);
      expect(dataStore.snapshot()).toContainEqual({
        key: ["payload-server-context"],
        value: { internalNote: "server-only-computation", name: "Ada" },
      });
      dataStore.dispose();
    },
  );

  it("streams a previously omitted dependency when a later Payload task reads it", async () => {
    const gate = deferred<void>();
    const source = dataResource({
      key: () => ["payload-later-source"],
      load: () => "source-value",
    });
    const derived = dataResource({
      key: () => ["payload-early-derived"],
      load: async ({ data }) => `derived:${await data.ensureData(source)}`,
    });
    function Early() {
      return createElement("span", null, readData(derived));
    }
    function Direct() {
      return createElement("span", null, readData(source));
    }
    async function Late() {
      await gate.promise;
      return createElement(Direct);
    }
    const result = renderToPayloadStream([
      createElement(Early),
      createElement(Late),
    ]);
    const hydrated: unknown[] = [];
    const done = deferred<void>();
    void decodePayloadStream(result.stream, {
      hydrate: (entries) => {
        hydrated.push(...entries);
        gate.resolve(undefined);
        return true;
      },
      onStreamDone: () => done.resolve(undefined),
    });
    await done.promise;
    expect(hydrated).toEqual([
      { key: ["payload-early-derived"], value: "derived:source-value" },
      { key: ["payload-later-source"], value: "source-value" },
    ]);
  });

  it("retries a transfer omitted before a later direct Payload read", async () => {
    const state = { ready: false, rows: ["Ada"] };
    let loads = 0;
    const source = dataResource({
      key: () => ["payload-late-form"],
      load: () => {
        loads += 1;
        return state;
      },
      transfer: (value: typeof state) => (value.ready ? value.rows : undefined),
    });
    const gate = deferred<void>();
    function Read() {
      const value = readData(source);
      return createElement("p", null, value.ready ? value.rows[0] : "loading");
    }
    async function Late() {
      await gate.promise;
      return createElement(Read);
    }
    const result = renderToPayloadStream([
      createElement(Read),
      createElement(Late),
    ]);
    const [textStream, decodeStream] = result.stream.tee();
    const reader = textStream.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    let text = decoder.decode(first.value);
    expect(text).not.toContain('"tag":"data"');

    // The live value becomes transferable without reloading or publishing.
    // Reading it in a later task must reconsider its omitted transfer form.
    state.ready = true;
    gate.resolve(undefined);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(loads).toBe(1);
    const dataAt = text.indexOf('"tag":"data"');
    expect(dataAt).toBeGreaterThanOrEqual(0);
    expect(dataAt).toBeLessThan(text.indexOf('"id":1,"tag":"model"'));

    const hydrated: unknown[] = [];
    const done = deferred<void>();
    void decodePayloadStream(decodeStream, {
      hydrate: (entries) => {
        hydrated.push(...entries);
        return true;
      },
      onStreamDone: () => done.resolve(undefined),
    });
    await done.promise;
    expect(hydrated).toEqual([{ key: ["payload-late-form"], value: ["Ada"] }]);
  });

  it("streams payload data rows before the model that may read them on the client", async () => {
    const userResource = dataResource<[string], { name: string }>({
      key: (id: string) => ["payload-user", id],
      load: () => ({ name: "Grace" }),
    });

    function ServerProfile() {
      const user = readData(userResource, "one");
      return createElement("span", null, user.name);
    }

    const result = renderToPayloadStream(createElement(ServerProfile, null));

    const [rowText, decodeStream] = result.stream.tee();
    const streamText = await readStream(rowText);
    const dataIndex = streamText.indexOf('"tag":"data"');
    const modelIndex = streamText.indexOf('"tag":"model"');

    expect(dataIndex).toBeGreaterThanOrEqual(0);
    expect(modelIndex).toBeGreaterThan(dataIndex);

    const hydrated: unknown[] = [];
    const done = deferred<void>();
    void decodePayloadStream(decodeStream, {
      hydrate: (entries) => {
        hydrated.push(...entries);
        return true;
      },
      onStreamDone: () => done.resolve(undefined),
    });
    await done.promise;

    expect(hydrated).toEqual([
      { key: ["payload-user", "one"], value: { name: "Grace" } },
    ]);
  });
});
