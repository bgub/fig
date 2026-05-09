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

  it("controls input values without resetting selection on equal updates", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("input", { value: "First" })));

    const input = container.childNodes[0] as FakeElement;
    input.value = "Typed";

    flushSync(() => root.render(createElement("input", { value: "First" })));
    expect(input.value).toBe("First");
    expect(input.attributes.value).toBe("First");

    input.value = "First";
    flushSync(() => root.render(createElement("input", { value: "First" })));
    expect(input.value).toBe("First");
  });

  it("applies default input values only while uncontrolled", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement("input", { defaultValue: "Initial" })),
    );

    const input = container.childNodes[0] as FakeElement;
    expect(input.value).toBe("Initial");
    expect(input.defaultValue).toBe("Initial");
    expect(input.attributes.value).toBe("Initial");

    input.value = "Typed";
    flushSync(() =>
      root.render(createElement("input", { defaultValue: "Next" })),
    );

    expect(input.value).toBe("Typed");
    expect(input.defaultValue).toBe("Next");
    expect(input.attributes.value).toBe("Next");
  });

  it("controls checked state separately from default checked state", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement("input", { defaultChecked: true })),
    );

    const input = container.childNodes[0] as FakeElement;
    expect(input.checked).toBe(true);
    expect(input.defaultChecked).toBe(true);
    expect(input.attributes.checked).toBe("true");

    input.checked = false;
    flushSync(() =>
      root.render(createElement("input", { defaultChecked: true })),
    );
    expect(input.checked).toBe(false);

    flushSync(() => root.render(createElement("input", { checked: true })));
    expect(input.checked).toBe(true);

    input.checked = false;
    flushSync(() => root.render(createElement("input", { checked: true })));
    expect(input.checked).toBe(true);
  });

  it("updates textarea content through value and defaultValue", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement("textarea", { defaultValue: "Draft" })),
    );

    const textarea = container.childNodes[0] as FakeElement;
    expect(textarea.value).toBe("Draft");
    expect(textarea.defaultValue).toBe("Draft");
    expect(textarea.textContent).toBe("Draft");
    expect(textarea.attributes.value).toBeUndefined();

    textarea.value = "Typed";
    flushSync(() =>
      root.render(createElement("textarea", { defaultValue: "Next" })),
    );
    expect(textarea.value).toBe("Typed");
    expect(textarea.defaultValue).toBe("Next");
    expect(textarea.textContent).toBe("Next");

    flushSync(() =>
      root.render(createElement("textarea", { value: "Controlled" })),
    );
    expect(textarea.value).toBe("Controlled");
    expect(textarea.textContent).toBe("Controlled");
    expect(textarea.attributes.value).toBeUndefined();
  });

  it("selects option values for controlled and default select props", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "select",
          { defaultValue: "b" },
          createElement("option", { value: "a" }, "A"),
          createElement("option", { value: "b" }, "B"),
        ),
      ),
    );

    const select = container.childNodes[0] as FakeElement;
    const first = select.childNodes[0] as FakeElement;
    const second = select.childNodes[1] as FakeElement;
    expect(select.attributes.value).toBeUndefined();
    expect(first.selected).toBe(false);
    expect(second.selected).toBe(true);

    first.selected = true;
    second.selected = false;
    flushSync(() =>
      root.render(
        createElement(
          "select",
          { defaultValue: "b" },
          createElement("option", { value: "a" }, "A"),
          createElement("option", { value: "b" }, "B"),
        ),
      ),
    );
    expect(first.selected).toBe(true);
    expect(second.selected).toBe(false);

    flushSync(() =>
      root.render(
        createElement(
          "select",
          { value: "b" },
          createElement("option", { value: "a" }, "A"),
          createElement("option", { value: "b" }, "B"),
        ),
      ),
    );
    expect(select.attributes.value).toBeUndefined();
    expect(first.selected).toBe(false);
    expect(second.selected).toBe(true);
  });

  it("syncs controlled select options through optgroups and option value changes", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "select",
          { value: "b" },
          createElement(
            "optgroup",
            null,
            createElement("option", { value: "a" }, "A"),
            createElement("option", { value: "b" }, "B"),
          ),
        ),
      ),
    );

    const select = container.childNodes[0] as FakeElement;
    const optgroup = select.childNodes[0] as FakeElement;
    const first = optgroup.childNodes[0] as FakeElement;
    const second = optgroup.childNodes[1] as FakeElement;
    expect(first.selected).toBe(false);
    expect(second.selected).toBe(true);

    flushSync(() =>
      root.render(
        createElement(
          "select",
          { value: "b" },
          createElement(
            "optgroup",
            null,
            createElement("option", { value: "b" }, "A"),
            createElement("option", { value: "c" }, "B"),
          ),
        ),
      ),
    );

    expect(first.selected).toBe(true);
    expect(second.selected).toBe(false);
  });

  it("clears stale select state when select value props are removed", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "select",
          { value: "b" },
          createElement("option", { value: "a" }, "A"),
        ),
      ),
    );

    const select = container.childNodes[0] as FakeElement;
    const first = select.childNodes[0] as FakeElement;

    flushSync(() =>
      root.render(
        createElement(
          "select",
          null,
          createElement("option", { value: "a" }, "A"),
          createElement("option", { value: "b" }, "B"),
        ),
      ),
    );

    const second = select.childNodes[1] as FakeElement;
    expect(first.selected).toBe(false);
    expect(second.selected).toBe(false);
  });
});
