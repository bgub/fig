// @vitest-environment happy-dom
import {
  dataResource,
  type FigNode,
  readData,
  Suspense,
  useState,
} from "@bgub/fig";
import { STREAMED_DATA_PROPERTY } from "@bgub/fig/internal";
import { renderToStream } from "@bgub/fig-server";
import { afterEach, describe, expect, it } from "vitest";
import { flushSync, hydrateRoot, on } from "./index.ts";
import { deferred, waitForHostTurns } from "./test-utils.ts";

afterEach(() => {
  document.body.replaceChildren();
  delete (document as unknown as Record<string, unknown>)[
    STREAMED_DATA_PROPERTY
  ];
});

describe("streamed data rows", () => {
  it("hydrates a late boundary from rows streamed ahead of its reveal", async () => {
    const gate = deferred<string>();
    let server = true;
    let browserLoads = 0;
    const resource = dataResource<[], string>({
      key: () => ["streamed-hydration"],
      load: () => {
        if (server) return gate.promise;
        browserLoads += 1;
        return "browser-value";
      },
    });

    function Late(): FigNode {
      const value = readData(resource);
      const [clicks, setClicks] = useState(0);
      return (
        <button mix={on("click", () => setClicks((count) => count + 1))}>
          {`${value}:${clicks}`}
        </button>
      );
    }
    const tree = (
      <main>
        <Suspense fallback={<p>pending</p>}>
          <Late />
        </Suspense>
      </main>
    );

    const result = renderToStream(tree);
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let shell = "";
    while (!shell.includes("pending")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("Expected the shell.");
      shell += decoder.decode(chunk.value, { stream: true });
    }
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = shell;
    const executed = new Set<Element>();
    runScripts(host, executed);

    server = false;
    const errors: unknown[] = [];
    const root = flushSync(() =>
      hydrateRoot(host, tree, {
        onRecoverableError: (error) => errors.push(error),
      }),
    );

    try {
      gate.resolve("server-value");
      let rest = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rest += decoder.decode(chunk.value, { stream: true });
      }
      expect(rest.indexOf(".d(")).toBeLessThan(rest.indexOf(".c("));
      host.insertAdjacentHTML("beforeend", rest);
      runScripts(host, executed);
      await waitForHostTurns();

      const button = host.querySelector("button");
      expect(button?.textContent).toBe("server-value:0");
      expect(browserLoads).toBe(0);
      expect(errors).toEqual([]);

      flushSync(() => button?.click());
      expect(button?.textContent).toBe("server-value:1");
    } finally {
      root.unmount();
    }
  });

  it("keeps a value the client already holds", () => {
    const resource = dataResource<[], string>({
      key: () => ["streamed-kept"],
      load: () => "unused",
    });
    function Kept(): FigNode {
      return <span>{readData(resource)}</span>;
    }
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = "<span>client-value</span>";
    const root = flushSync(() =>
      hydrateRoot(host, <Kept />, {
        initialData: [{ key: ["streamed-kept"], value: "client-value" }],
      }),
    );

    try {
      const queues = (document as unknown as Record<string, unknown>)[
        STREAMED_DATA_PROPERTY
      ] as Record<string, { push(rows: unknown[]): void }>;
      flushSync(() =>
        queues[""]?.push([{ key: ["streamed-kept"], value: "late-value" }]),
      );

      const store = root.data as unknown as {
        snapshot(): Array<{ key: unknown; value: unknown }>;
      };
      expect(store.snapshot()).toEqual([
        { key: ["streamed-kept"], value: "client-value" },
      ]);
      expect(host.textContent).toBe("client-value");
    } finally {
      root.unmount();
    }
  });
});

function runScripts(host: Element, executed: Set<Element>): void {
  for (const script of host.querySelectorAll("script")) {
    if (executed.has(script)) continue;
    executed.add(script);
    // oxlint-disable-next-line typescript-eslint/no-implied-eval
    new Function(script.textContent ?? "")();
  }
}
