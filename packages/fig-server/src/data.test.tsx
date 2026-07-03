import { createElement } from "@bgub/fig";
import { dataResource, readData } from "@bgub/fig-data";
import { createDataStore } from "@bgub/fig-data/internal";
import { describe, expect, it } from "vite-plus/test";
import { readStream } from "./test-utils.ts";
import { renderToReadableStream } from "./index.ts";
import { createRscResponse, renderToRscStream } from "./rsc.ts";

describe("@bgub/fig-server data resources", () => {
  it("renders data resources and exposes fulfilled entries", async () => {
    const userIdentity = dataResource.identity<[string], string>({
      key: (id: string) => ["ssr-user", id],
    });
    const userResource = dataResource.server(userIdentity, {
      load: () => "Ada",
    });

    function Profile() {
      return createElement("span", null, readData(userResource, "one"));
    }

    const result = renderToReadableStream(createElement(Profile, null));

    await result.allReady;

    expect(await readStream(result.stream)).toBe("<span>Ada</span>");
    expect(result.getData()).toEqual([
      { key: ["ssr-user", "one"], value: "Ada" },
    ]);
  });

  it("streams RSC data rows before the model that may read them on the client", async () => {
    const userIdentity = dataResource.identity<[string], { name: string }>({
      key: (id: string) => ["rsc-user", id],
    });
    const userResource = dataResource.server(userIdentity, {
      load: () => ({ name: "Grace" }),
    });

    function ServerProfile() {
      const user = readData(userResource, "one");
      return createElement("span", null, user.name);
    }

    const result = renderToRscStream(createElement(ServerProfile, null));

    await result.allReady;

    const streamText = await readStream(result.stream);
    const dataIndex = streamText.indexOf('"tag":"data"');
    const modelIndex = streamText.indexOf('"tag":"model"');

    expect(dataIndex).toBeGreaterThanOrEqual(0);
    expect(modelIndex).toBeGreaterThan(dataIndex);

    const response = createRscResponse();
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    response.bindRoot({
      data: store,
      render: () => undefined,
    });
    response.processStringChunk(streamText);

    expect(store.snapshot()).toEqual([
      { key: ["rsc-user", "one"], value: { name: "Grace" } },
    ]);
  });
});
