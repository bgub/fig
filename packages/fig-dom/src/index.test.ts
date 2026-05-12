import { createElement } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { batchedUpdates, createRoot, flushSync, render } from "./index.ts";
import { delay, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom", () => {
  it("renders and updates host elements", async () => {
    const container = new FakeElement("root");

    render(
      createElement("div", { class: "box", id: "first" }, "Hello"),
      container as unknown as Element,
    );
    await delay();

    expect(container.textContent).toBe("Hello");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      class: "box",
      id: "first",
    });

    render(
      createElement("div", { id: "second" }, "Goodbye"),
      container as unknown as Element,
    );
    await delay();

    expect(container.textContent).toBe("Goodbye");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      id: "second",
    });
  });

  it("supports root unmounts", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement("main", null, "Mounted"));
    await delay();
    expect(container.textContent).toBe("Mounted");

    root.unmount();
    await delay();
    expect(container.textContent).toBe("");
  });

  it("flushes sync work before returning", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Now")));

    expect(container.textContent).toBe("Now");
  });

  it("flushes batched root work inside flushSync", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Before")));

    batchedUpdates(() => {
      root.render(createElement("main", null, "After"));
      expect(container.textContent).toBe("Before");

      flushSync(() => undefined);

      expect(container.textContent).toBe("After");
    });
  });

  it("creates SVG, MathML, and foreignObject elements in the right namespace", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "svg",
          null,
          createElement("circle", null),
          createElement("foreignObject", null, createElement("div", null)),
          createElement("svg", null),
        ),
      ),
    );

    const svg = container.childNodes[0] as FakeElement;
    const circle = svg.childNodes[0] as FakeElement;
    const foreignObject = svg.childNodes[1] as FakeElement;
    const div = foreignObject.childNodes[0] as FakeElement;
    const nestedSvg = svg.childNodes[2] as FakeElement;

    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(foreignObject.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(div.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(nestedSvg.namespaceURI).toBe("http://www.w3.org/2000/svg");

    flushSync(() =>
      root.render(createElement("math", null, createElement("mi", null, "x"))),
    );

    const math = container.childNodes[0] as FakeElement;
    const mi = math.childNodes[0] as FakeElement;
    expect(math.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    expect(mi.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
  });
});
