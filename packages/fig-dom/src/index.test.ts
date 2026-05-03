import { createElement } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { batchedUpdates, createRoot, flushSync, render } from "./index.ts";
import { delay, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom", () => {
  it("renders and updates host elements", async () => {
    const container = new FakeElement("root");

    render(
      createElement("div", { id: "first", className: "box" }, "Hello"),
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
});
