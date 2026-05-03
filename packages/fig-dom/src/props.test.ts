import { createElement } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync, on } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom props", () => {
  it("updates DOM props without leaking stale attributes or listeners", () => {
    const calls: string[] = [];
    const firstClick = () => calls.push("first");
    const secondClick = () => calls.push("second");
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement("button", {
          className: "primary",
          disabled: true,
          events: [on("click", firstClick)],
          style: { color: "red", fontWeight: "bold" },
        }),
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    expect(button.attributes).toEqual({ class: "primary", disabled: "true" });
    expect(button.style.color).toBe("red");
    expect(button.style.fontWeight).toBe("bold");
    button.dispatch("click");
    expect(calls).toEqual(["first"]);

    flushSync(() =>
      root.render(
        createElement("button", {
          disabled: false,
          events: [on("click", secondClick)],
          style: { color: "blue" },
        }),
      ),
    );

    expect(button.attributes).toEqual({});
    expect(button.style.color).toBe("blue");
    expect(button.style.fontWeight).toBe("");
    button.dispatch("click");
    expect(calls).toEqual(["first", "second"]);

    flushSync(() => root.render(createElement("button", null)));

    expect(container.listeners.click).toBeUndefined();
    expect(button.style.color).toBe("");
  });
});
