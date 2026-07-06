import { createElement, readData } from "@bgub/fig";
import { createDataStore } from "@bgub/fig/internal";
import { serverDataResource } from "@bgub/fig/server";
import { describe, expect, it } from "vite-plus/test";
import { prerender, renderToStream } from "./index.ts";
import { createPayloadResponse, renderToPayloadStream } from "./payload.ts";
import { readStream } from "./test-utils.ts";

describe("@bgub/fig-server data resources", () => {
  it("renders data resources and exposes fulfilled entries", async () => {
    const userResource = serverDataResource<[string], string>({
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
    const userResource = serverDataResource<[string], string>({
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

  it("streams payload data rows before the model that may read them on the client", async () => {
    const userResource = serverDataResource<[string], { name: string }>({
      key: (id: string) => ["payload-user", id],
      load: () => ({ name: "Grace" }),
    });

    function ServerProfile() {
      const user = readData(userResource, "one");
      return createElement("span", null, user.name);
    }

    const result = renderToPayloadStream(createElement(ServerProfile, null));

    await result.allReady;

    const streamText = await readStream(result.stream);
    const dataIndex = streamText.indexOf('"tag":"data"');
    const modelIndex = streamText.indexOf('"tag":"model"');

    expect(dataIndex).toBeGreaterThanOrEqual(0);
    expect(modelIndex).toBeGreaterThan(dataIndex);

    const response = createPayloadResponse();
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    response.bindRoot({
      data: store,
      render: () => undefined,
    });
    response.processStringChunk(streamText);

    expect(store.snapshot()).toEqual([
      { key: ["payload-user", "one"], value: { name: "Grace" } },
    ]);
  });
});
