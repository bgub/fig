import {
  createContext,
  createElement,
  Fragment,
  readContext,
  readPromise,
  Suspense,
  useMemo,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { renderToReadableStream, renderToString } from "./index.ts";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

describe("@bgub/fig-server", () => {
  it("renders host elements and escapes text and attributes", async () => {
    const html = await renderToString(
      createElement(
        "button",
        {
          className: "primary",
          disabled: true,
          value: '<&"',
          events: [{}],
          bind: () => undefined,
          onClick: () => undefined,
          style: {
            backgroundColor: "red",
            "--gap": "1rem",
            opacity: 0,
          },
        },
        "Save & <",
      ),
    );

    expect(html).toBe(
      '<button class="primary" disabled value="&lt;&amp;&quot;" style="background-color:red;--gap:1rem;opacity:0">Save &amp; &lt;</button>',
    );
  });

  it("renders fragments, arrays, function components, and state initializers", async () => {
    function Counter() {
      const [count] = useState(() => 3);
      const label = useMemo(() => "Count ", []);
      useReactive(() => {
        throw new Error("Server effects should not run.");
      });

      return createElement("span", null, label, count);
    }

    const html = await renderToString(
      createElement(Fragment, null, createElement("h1", null, "Fig"), [
        createElement(Counter, { key: "counter" }),
        " done",
      ]),
    );

    expect(html).toBe("<h1>Fig</h1><span>Count 3</span> done");
  });

  it("reads server context values from the nearest provider", async () => {
    const Theme = createContext("light");

    function Badge() {
      return createElement("span", null, readContext(Theme));
    }

    const html = await renderToString(
      createElement(
        "section",
        null,
        createElement(Badge, null),
        createElement(Theme, { value: "dark" }, createElement(Badge, null)),
      ),
    );

    expect(html).toBe("<section><span>light</span><span>dark</span></section>");
  });

  it("renders Suspense fallback when a promise is pending", async () => {
    const promise = new Promise<string>(() => undefined);

    function Message() {
      return createElement("span", null, readPromise(promise));
    }

    const html = await renderToString(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement("div", null, "Before ", createElement(Message, null)),
      ),
    );

    expect(html).toBe("<em>Loading</em>");
  });

  it("returns a Web stream result with an allReady promise", async () => {
    const result = await renderToReadableStream(createElement("p", null, "Hi"));

    await expect(result.allReady).resolves.toBeUndefined();
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(await readStream(result.stream)).toBe("<p>Hi</p>");
  });

  it("rejects render-phase state updates", async () => {
    function Bad() {
      const [, setCount] = useState(0);
      setCount(1);
      return null;
    }

    await expect(renderToString(createElement(Bad, null))).rejects.toThrow(
      "State updates are not allowed during server render.",
    );
  });

  it("throws for invalid children and invalid host props", async () => {
    await expect(
      renderToString(createElement("div", null, { nope: true })),
    ).rejects.toThrow("Invalid Fig child: object with keys nope.");

    await expect(
      renderToString(createElement("div", { data: { nope: true } })),
    ).rejects.toThrow('Cannot serialize prop "data" to HTML.');
  });

  it("renders void elements and rejects their children", async () => {
    await expect(
      renderToString(createElement("input", { value: "Fig" })),
    ).resolves.toBe('<input value="Fig">');

    await expect(
      renderToString(createElement("input", null, "child")),
    ).rejects.toThrow("Void element <input> cannot have children.");
  });
});
