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
      "Pass partition and initialData to createDataStore()",
    );

    dataStore.dispose();
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
