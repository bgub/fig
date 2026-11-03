import {
  createDataStore,
  createElement,
  dataResource,
  type FigNode,
  readData,
  Suspense,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { renderToStream } from "./index.ts";
import type { ServerRenderOptions } from "./types.ts";
import { deferred } from "./shared.ts";
import { readStream } from "./test-utils.ts";

const shellResource = dataResource<[], string>({
  key: () => ["streamed-shell"],
  load: () => "shell-value",
});

function Value(props: { resource: typeof shellResource }): FigNode {
  return createElement("span", null, readData(props.resource));
}

function render(boundaries: FigNode[], options?: ServerRenderOptions) {
  return renderToStream(
    createElement(
      "main",
      null,
      createElement(Value, { resource: shellResource }),
      ...boundaries.map((child, index) =>
        createElement(
          Suspense,
          { fallback: createElement("p", null, "pending"), key: index },
          child,
        ),
      ),
    ),
    options,
  );
}

function deferredResource(name: string) {
  const load = deferred<unknown>();
  const resource = dataResource<[], string>({
    key: () => [name],
    load: () => load.promise as Promise<string>,
  });
  return { load, resource };
}

describe("@bgub/fig-server streamed data", () => {
  it("streams boundary reads ahead of their reveal and leaves shell reads to takeData", async () => {
    const late = deferredResource("streamed-late");
    const result = render([createElement(Value, { resource: late.resource })]);
    await result.shellReady;

    expect(result.takeData()).toEqual([
      { key: ["streamed-shell"], value: "shell-value" },
    ]);
    late.load.resolve("late-value");
    const html = await readStream(result.stream);

    const operation = html.indexOf(".d(");
    expect(operation).toBeGreaterThan(html.indexOf("late-value"));
    expect(operation).toBeLessThan(html.indexOf(".c("));
    expect(html.match(/\.d\(/g)).toHaveLength(1);
    expect(html.slice(operation)).toContain('"key":["streamed-late"]');
    expect(html).not.toContain('"key":["streamed-shell"]');
    expect(result.takeData()).toEqual([]);
  });

  it("delivers a key once across boundaries and takeData", async () => {
    const shared = deferredResource("streamed-shared");
    const result = render([
      createElement(Value, { resource: shared.resource }),
      createElement(Value, { resource: shared.resource }),
    ]);
    await result.shellReady;
    shared.load.resolve("shared-value");
    const html = await readStream(result.stream);

    expect(html.match(/"key":\["streamed-shared"\]/g)).toHaveLength(1);
    expect(result.takeData()).toEqual([
      { key: ["streamed-shell"], value: "shell-value" },
    ]);
  });

  it("does not stream entries takeData already returned", async () => {
    const taken = dataResource<[], string>({
      key: () => ["streamed-taken"],
      load: () => "unused",
    });
    const gate = deferredResource("streamed-gate");
    function Gated(): FigNode {
      return createElement(
        "span",
        null,
        readData(taken),
        readData(gate.resource),
      );
    }
    const result = render([createElement(Gated)], {
      dataStore: createDataStore({
        initialData: [{ key: ["streamed-taken"], value: "taken-value" }],
      }),
    });
    await result.shellReady;

    expect(result.takeData()).toContainEqual({
      key: ["streamed-taken"],
      value: "taken-value",
    });
    gate.load.resolve("gate-value");
    const html = await readStream(result.stream);
    expect(html).toContain('"key":["streamed-gate"]');
    expect(html).not.toContain('"key":["streamed-taken"]');
  });

  it("streams a boundary read with the entries its load ensured", async () => {
    class Connection {
      constructor(readonly rows: string[]) {}
    }
    const gate = deferred<unknown>();
    const connection = dataResource<[], Connection>({
      key: () => ["streamed-connection"],
      load: () => new Connection(["a", "b"]),
      transfer: false,
    });
    const source = dataResource<[], string[]>({
      key: () => ["streamed-source"],
      load: async ({ data }) => {
        await gate.promise;
        return (await data.ensureData(connection)).rows;
      },
    });
    const derived = dataResource<[], string>({
      key: () => ["streamed-derived"],
      load: async ({ data }) => (await data.ensureData(source)).join(","),
    });
    const result = render([createElement(Value, { resource: derived })]);
    await result.shellReady;

    expect(result.takeData()).toEqual([
      { key: ["streamed-shell"], value: "shell-value" },
    ]);
    gate.resolve(undefined);
    const html = await readStream(result.stream);

    // Sources precede the read that derived from them; the connection stays
    // on the server.
    const operation = html.slice(html.indexOf(".d("));
    expect(operation.indexOf('"key":["streamed-source"]')).toBeGreaterThan(-1);
    expect(operation.indexOf('"key":["streamed-source"]')).toBeLessThan(
      operation.indexOf('"key":["streamed-derived"]'),
    );
    expect(html).not.toContain('"key":["streamed-connection"]');
    expect(result.takeData()).toEqual([]);
  });

  it("honors the filter and the disabled option", async () => {
    const kept = deferredResource("streamed-kept");
    const dropped = deferredResource("streamed-dropped");
    const filtered = render(
      [
        createElement(Value, { resource: kept.resource }),
        createElement(Value, { resource: dropped.resource }),
      ],
      {
        streamData: {
          filter: (entry) => entry.key[0] !== "streamed-dropped",
        },
      },
    );
    kept.load.resolve("kept-value");
    dropped.load.resolve("dropped-value");
    const filteredHtml = await readStream(filtered.stream);
    expect(filteredHtml).toContain('"key":["streamed-kept"]');
    expect(filteredHtml).not.toContain('"key":["streamed-dropped"]');

    const disabled = deferredResource("streamed-disabled");
    const off = render(
      [createElement(Value, { resource: disabled.resource })],
      {
        streamData: false,
      },
    );
    disabled.load.resolve("disabled-value");
    expect(await readStream(off.stream)).not.toContain(".d(");
  });

  it("skips values the Payload codec cannot encode", async () => {
    const encodable = deferredResource("streamed-encodable");
    const opaque = deferredResource("streamed-opaque");
    function Opaque(): FigNode {
      readData(opaque.resource);
      return createElement("i", null, "opaque");
    }
    const result = render([
      createElement(
        "div",
        null,
        createElement(Value, { resource: encodable.resource }),
        createElement(Opaque),
      ),
    ]);
    encodable.load.resolve("encodable-value");
    opaque.load.resolve(() => undefined);
    const html = await readStream(result.stream);

    expect(html).toContain('"key":["streamed-encodable"]');
    expect(html).not.toContain('"key":["streamed-opaque"]');
    expect(html).toContain(".c(");
  });

  it("prefixes data operations with the render's identifierPrefix", async () => {
    const late = deferredResource("streamed-prefixed");
    const result = render([createElement(Value, { resource: late.resource })], {
      identifierPrefix: "app-",
    });
    late.load.resolve("prefixed-value");
    expect(await readStream(result.stream)).toContain('.d("app-",');
  });
});
