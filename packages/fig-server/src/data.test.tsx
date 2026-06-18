import { createElement } from "@bgub/fig";
import { createDataStore, dataResource, readData } from "@bgub/fig-data";
import { describe, expect, it } from "vite-plus/test";
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

    expect(await readStreamToString(result.stream)).toBe("<span>Ada</span>");
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

    const streamText = await readStreamToString(result.stream);
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

function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const textDecoder = new TextDecoder();
  let output = "";

  return reader.read().then(function readNext(result): Promise<string> {
    if (result.done) {
      output += textDecoder.decode();
      return Promise.resolve(output);
    }

    output += textDecoder.decode(result.value, { stream: true });
    return reader.read().then(readNext);
  });
}
