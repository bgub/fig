import { createElement, readData } from "@bgub/fig";
import { decodePayloadStream } from "@bgub/fig/payload";
import { serverDataResource } from "@bgub/fig/server";
import { describe, expect, it } from "vitest";
import { prerender, renderToStream } from "./index.ts";
import { renderToPayloadStream } from "./payload.ts";
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

    const [rowText, decodeStream] = result.stream.tee();
    const streamText = await readStream(rowText);
    const dataIndex = streamText.indexOf('"tag":"data"');
    const modelIndex = streamText.indexOf('"tag":"model"');

    expect(dataIndex).toBeGreaterThanOrEqual(0);
    expect(modelIndex).toBeGreaterThan(dataIndex);

    const hydrated: unknown[] = [];
    const decode = decodePayloadStream(decodeStream, {
      hydrate: (entries) => {
        hydrated.push(...entries);
        return true;
      },
    });
    await decode.completion;

    expect(hydrated).toEqual([
      { key: ["payload-user", "one"], value: { name: "Grace" } },
    ]);
  });
});
