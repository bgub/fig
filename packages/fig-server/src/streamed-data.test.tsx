import {
  createDataStore,
  createElement,
  dataResource,
  type FigNode,
  readData,
  Suspense,
} from "@bgub/fig";
import { decodePayloadDataEntries } from "@bgub/fig/internal";
import { describe, expect, it } from "vitest";
import { renderToDocumentStream, renderToStream } from "./index.ts";
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

  it("streams a boundary read with opted-in entries its load ensured", async () => {
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
      transfer: (value) => value,
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

    // The read's row and a marker for its source precede the reveal, and the
    // source's form follows it; the connection stays on the server.
    const reveal = html.indexOf(".c(");
    const marker = html.indexOf('{"key":["streamed-source"],"pending":true}');
    const form = html.indexOf('{"key":["streamed-source"],"value":');
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(reveal);
    expect(html.indexOf('"key":["streamed-derived"]')).toBeLessThan(reveal);
    expect(form).toBeGreaterThan(reveal);
    expect(html).not.toContain('"key":["streamed-connection"]');
    expect(result.takeData()).toEqual([]);
  });

  function derivedFromSource(name: string) {
    const source = dataResource<[], string[]>({
      key: () => [`${name}-source`],
      transfer: (value) => value,
      load: async () => ["a", "b"],
    });
    return dataResource<[], string>({
      key: () => [`${name}-derived`],
      load: async ({ data }) => (await data.ensureData(source)).join(","),
    });
  }

  it("streams a shell read's opted-in dependencies after the shell, behind markers ahead of it", async () => {
    const derived = derivedFromSource("shell-fragment");
    const result = renderToStream(
      createElement("main", null, createElement(Value, { resource: derived })),
    );
    await result.shellReady;

    // The snapshot gets the read's row; its source is the stream's.
    expect(result.takeData()).toEqual([
      { key: ["shell-fragment-derived"], value: "a,b" },
    ]);
    const html = await readStream(result.stream);
    const marker = html.indexOf(
      '{"key":["shell-fragment-source"],"pending":true}',
    );
    const form = html.indexOf('{"key":["shell-fragment-source"],"value":');
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(html.indexOf("<main>"));
    expect(form).toBeGreaterThan(html.indexOf("</main>"));
    expect(result.takeData()).toEqual([]);
  });

  it("marks a document's shell dependencies first in <head>", async () => {
    const derived = derivedFromSource("shell-document");
    const result = renderToDocumentStream(
      createElement(
        "html",
        null,
        createElement("head", null, createElement("title", null, "Doc")),
        createElement(
          "body",
          null,
          createElement(Value, { resource: derived }),
        ),
      ),
    );
    const html = await readStream(result.stream);
    const marker = html.indexOf(
      '{"key":["shell-document-source"],"pending":true}',
    );
    expect(html.indexOf("<head>")).toBeLessThan(marker);
    expect(marker).toBeLessThan(html.indexOf("<title"));
    expect(
      html.indexOf('{"key":["shell-document-source"],"value":'),
    ).toBeGreaterThan(html.indexOf("</body>"));
  });

  it("defers the dependencies of a boundary that completes inside the shell", async () => {
    const derived = derivedFromSource("shell-inline");
    // Loaded ahead of rendering, as by a route loader, so the boundary's
    // content renders inline with the shell instead of revealing later.
    const dataStore = createDataStore();
    await dataStore.ensureData(derived);
    const result = renderToStream(
      createElement(
        "main",
        null,
        createElement(
          Suspense,
          { fallback: createElement("p", null, "pending") },
          createElement(Value, { resource: derived }),
        ),
      ),
      { dataStore },
    );
    await result.shellReady;

    expect(result.takeData().map((entry) => entry.key)).not.toContainEqual([
      "shell-inline-source",
    ]);
    const html = await readStream(result.stream);
    expect(html).not.toContain(".c(");
    expect(
      html.indexOf('{"key":["shell-inline-source"],"pending":true}'),
    ).toBeLessThan(html.indexOf("<main>"));
    expect(
      html.indexOf('{"key":["shell-inline-source"],"value":'),
    ).toBeGreaterThan(html.indexOf("</main>"));
  });

  it("defers the dependencies of a fallback the shell shows", async () => {
    const derived = derivedFromSource("shell-fallback");
    const late = deferredResource("shell-fallback-late");
    const result = renderToStream(
      createElement(
        "main",
        null,
        createElement(
          Suspense,
          { fallback: createElement(Value, { resource: derived }) },
          createElement(Value, { resource: late.resource }),
        ),
      ),
    );
    await result.shellReady;

    expect(result.takeData().map((entry) => entry.key)).not.toContainEqual([
      "shell-fallback-source",
    ]);
    late.load.resolve("late-value");
    const html = await readStream(result.stream);
    expect(
      html.indexOf('{"key":["shell-fallback-source"],"pending":true}'),
    ).toBeLessThan(html.indexOf("<main>"));
  });

  it("leaves shell dependencies to takeData with streamData: false", async () => {
    const derived = derivedFromSource("shell-unstreamed");
    const result = renderToStream(
      createElement("main", null, createElement(Value, { resource: derived })),
      { streamData: false },
    );
    await result.shellReady;
    expect(result.takeData()).toContainEqual({
      key: ["shell-unstreamed-source"],
      value: ["a", "b"],
    });
    expect(await readStream(result.stream)).not.toContain(".d(");
  });

  it("writes a dependency's form after the boundary's reveal, past its segment fills", async () => {
    const gate = deferredResource("streamed-fill-gate");
    const source = dataResource<[], string[]>({
      key: () => ["streamed-fill-source"],
      transfer: (value) => value,
      load: async () => ["a"],
    });
    const derived = dataResource<[], string>({
      key: () => ["streamed-fill-derived"],
      load: async ({ data }) => (await data.ensureData(source)).join(","),
    });
    // The second suspension stages the derived read in a segment of its own,
    // filled (`s`) before the boundary reveals (`c`).
    function Late(): FigNode {
      readData(gate.resource);
      return createElement(Value, { resource: derived });
    }
    const result = render([createElement(Late)]);
    await result.shellReady;
    gate.load.resolve("open");
    const html = await readStream(result.stream);

    // The last fill stages the derived read; its marker precedes it.
    const fill = html.lastIndexOf(".s(");
    const reveal = html.indexOf(".c(");
    expect(fill).toBeGreaterThan(-1);
    expect(fill).toBeLessThan(reveal);
    expect(
      html.indexOf('{"key":["streamed-fill-source"],"pending":true}'),
    ).toBeLessThan(fill);
    expect(
      html.indexOf('{"key":["streamed-fill-source"],"value":'),
    ).toBeGreaterThan(reveal);
  });

  it.each([
    ["reveals", ".c("],
    ["falls back to the browser", ".x("],
  ] as const)(
    "holds a dependency's form until its boundary %s, past partial flushes",
    async (outcome, operation) => {
      const source = dataResource<[], string[]>({
        key: () => ["streamed-partial-source"],
        transfer: (value) => value,
        load: async () => ["a"],
      });
      const quick = dataResource<[], string>({
        key: () => ["streamed-partial-quick"],
        load: async ({ data }) => (await data.ensureData(source)).join(","),
      });
      const slow = deferredResource("streamed-partial-slow");
      const result = render(
        [
          createElement(
            "div",
            null,
            createElement(Value, { resource: quick }),
            createElement(Value, { resource: slow.resource }),
          ),
        ],
        { onError: () => undefined },
      );
      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let html = "";
      // The quick read's segment flushes while its sibling keeps the boundary
      // pending.
      while (!html.includes('"key":["streamed-partial-quick"]')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Expected the quick segment.");
        html += decoder.decode(chunk.value, { stream: true });
      }
      expect(html).not.toContain(".c(");
      expect(html).toContain(
        '{"key":["streamed-partial-source"],"pending":true}',
      );
      expect(html).not.toContain('{"key":["streamed-partial-source"],"value":');

      if (outcome === "reveals") slow.load.resolve("slow-value");
      else slow.load.reject(new Error("slow failed"));
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        html += decoder.decode(chunk.value, { stream: true });
      }
      expect(html).toContain(operation);
      expect(
        html.indexOf('{"key":["streamed-partial-source"],"value":'),
      ).toBeGreaterThan(html.indexOf(operation));
    },
  );

  it.each(["direct read", "takeData"] as const)(
    "delivers a queued form for %s without waiting for its original boundary",
    async (delivery) => {
      const sharedForm = { text: "source-value" };
      const companion = dataResource<[], string>({
        key: () => ["streamed-shared-companion"],
        load: () => "companion-value",
        transfer: () => sharedForm,
      });
      const source = dataResource<[], string>({
        key: () => ["streamed-shared-source"],
        load: () => "source-value",
        transfer: () => sharedForm,
      });
      const quick = dataResource<[], string>({
        key: () => ["streamed-shared-query"],
        load: async ({ data }) => {
          await data.ensureData(companion);
          return data.ensureData(source);
        },
      });
      const slow = deferredResource("streamed-shared-slow");
      const gate = deferredResource("streamed-shared-gate");
      function Direct(): FigNode {
        readData(gate.resource);
        return createElement(Value, { resource: source });
      }
      const result = render([
        createElement(
          "div",
          null,
          createElement(Value, { resource: quick }),
          createElement(Value, { resource: slow.resource }),
        ),
        createElement(Direct),
      ]);
      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let html = "";
      async function readUntil(text: string): Promise<void> {
        while (!html.includes(text)) {
          const chunk = await reader.read();
          if (chunk.done)
            throw new Error(`Expected ${text} before stream end.`);
          html += decoder.decode(chunk.value, { stream: true });
        }
      }
      const form = '{"key":["streamed-shared-source"],"value":';
      await readUntil('{"key":["streamed-shared-source"],"pending":true}');
      expect(html).not.toContain(form);
      if (delivery === "takeData") {
        const taken = result.takeData();
        const sourceForm = taken.find(
          (entry) => entry.key[0] === "streamed-shared-source",
        )?.value;
        const companionForm = taken.find(
          (entry) => entry.key[0] === "streamed-shared-companion",
        )?.value;
        expect(sourceForm).toEqual(sharedForm);
        expect(sourceForm).toBe(companionForm);
      }
      gate.load.resolve("ready");
      await readUntil(".c(");
      const directReveal = html;
      // Finish the original boundary before asserting, so a regression does
      // not leave its request and reader hanging.
      slow.load.resolve("done");
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        html += decoder.decode(chunk.value, { stream: true });
      }
      if (delivery === "direct read") {
        expect(directReveal).toContain(form);
        expect(directReveal.indexOf(form)).toBeLessThan(
          directReveal.indexOf(".c("),
        );
        expect(html.split(form)).toHaveLength(2);
        const batches = [
          ...directReveal.matchAll(/__figSSR\.d\("",(\[.*?\])\)\}/g),
        ]
          .map((match) => JSON.parse(match[1]))
          .filter((rows) =>
            rows.some(
              (row: { key: string[]; value?: unknown }) =>
                row.key[0] === "streamed-shared-source" && "value" in row,
            ),
          );
        expect(batches).toHaveLength(1);
        const decoded = decodePayloadDataEntries(batches[0]);
        expect(decoded).toHaveLength(2);
        expect(decoded[0].value).toEqual(sharedForm);
        expect(decoded[0].value).toBe(decoded[1].value);
      } else {
        expect(html).not.toContain(form);
      }
      expect(
        result
          .takeData()
          .some((entry) => entry.key[0] === "streamed-shared-source"),
      ).toBe(false);
    },
  );

  it("sends a shared dependency's form with whichever reading boundary reveals first", async () => {
    const source = dataResource<[], string[]>({
      key: () => ["streamed-common-source"],
      transfer: (value) => value,
      load: async () => ["a"],
    });
    const first = dataResource<[], string>({
      key: () => ["streamed-common-first"],
      load: async ({ data }) => (await data.ensureData(source)).join(","),
    });
    const second = dataResource<[], string>({
      key: () => ["streamed-common-second"],
      load: async ({ data }) => `${(await data.ensureData(source)).join(",")}!`,
    });
    const slow = deferredResource("streamed-common-slow");
    const gate = deferredResource("streamed-common-gate");
    function Second(): FigNode {
      readData(gate.resource);
      return createElement(Value, { resource: second });
    }
    // The first boundary queues the form, then waits on its slow sibling;
    // the second reads the same source and reveals first.
    const result = render([
      createElement(
        "div",
        null,
        createElement(Value, { resource: first }),
        createElement(Value, { resource: slow.resource }),
      ),
      createElement(Second),
    ]);
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let html = "";
    async function readUntil(text: string): Promise<void> {
      while (!html.includes(text)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Expected ${text} before stream end.`);
        html += decoder.decode(chunk.value, { stream: true });
      }
    }
    const form = '{"key":["streamed-common-source"],"value":';
    await readUntil('{"key":["streamed-common-source"],"pending":true}');
    gate.load.resolve("open");
    // The form shares the reveal's chunk, so it is here once `c` is.
    await readUntil(".c(");
    const reveal = html.indexOf(".c(");
    expect(html.slice(0, reveal)).toContain('"key":["streamed-common-second"]');
    expect(html.indexOf(form)).toBeGreaterThan(reveal);

    slow.load.resolve("done");
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      html += decoder.decode(chunk.value, { stream: true });
    }
    expect(html.split(form)).toHaveLength(2);
  });

  it("sends a discarded nested boundary's forms with its ancestor's fallback", async () => {
    const source = dataResource<[], string[]>({
      key: () => ["streamed-discarded-source"],
      transfer: (value) => value,
      load: async () => ["a"],
    });
    const quick = dataResource<[], string>({
      key: () => ["streamed-discarded-quick"],
      load: async ({ data }) => (await data.ensureData(source)).join(","),
    });
    const slow = deferredResource("streamed-discarded-slow");
    const failing = deferredResource("streamed-discarded-failing");
    // The inner boundary's partial flush sends the marker; then the outer
    // boundary fails and discards it.
    const result = render(
      [
        createElement(
          "div",
          null,
          createElement(
            Suspense,
            { fallback: createElement("p", null, "inner") },
            createElement(
              "div",
              null,
              createElement(Value, { resource: quick }),
              createElement(Value, { resource: slow.resource }),
            ),
          ),
          createElement(Value, { resource: failing.resource }),
        ),
      ],
      { onError: () => undefined },
    );
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (
      !html.includes('{"key":["streamed-discarded-source"],"pending":true}')
    ) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("Expected the marker.");
      html += decoder.decode(chunk.value, { stream: true });
    }
    failing.load.reject(new Error("outer failed"));
    slow.load.resolve("done");
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      html += decoder.decode(chunk.value, { stream: true });
    }
    const fallback = html.indexOf(".x(");
    expect(fallback).toBeGreaterThan(-1);
    expect(
      html.indexOf('{"key":["streamed-discarded-source"],"value":'),
    ).toBeGreaterThan(fallback);
  });

  it("omits plain computation dependencies from HTML boundary data", async () => {
    const gate = deferred<void>();
    const source = dataResource({
      key: () => ["streamed-private-source"],
      load: async () => {
        await gate.promise;
        return { name: "Ada", internalNote: "server-only-computation" };
      },
    });
    const derived = dataResource({
      key: () => ["streamed-public-profile"],
      load: async ({ data }) => (await data.ensureData(source)).name,
    });
    const result = render([createElement(Value, { resource: derived })]);
    await result.shellReady;
    expect(result.takeData()).toEqual([
      { key: ["streamed-shell"], value: "shell-value" },
    ]);

    gate.resolve(undefined);
    const html = await readStream(result.stream);
    const operation = html.indexOf(".d(");
    expect(operation).toBeGreaterThan(-1);
    expect(operation).toBeLessThan(html.indexOf(".c("));
    expect(html.slice(operation)).toContain(
      '"key":["streamed-public-profile"]',
    );
    expect(html).not.toContain('"key":["streamed-private-source"]');
    expect(html).not.toContain("server-only-computation");
    // It was omitted by streaming policy, not by codec rejection or removal
    // from the store: an explicit snapshot can still deliver this plain value.
    expect(result.takeData()).toEqual([
      {
        key: ["streamed-private-source"],
        value: { name: "Ada", internalNote: "server-only-computation" },
      },
    ]);
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
