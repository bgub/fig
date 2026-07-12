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
          class: "primary",
          disabled: true,
          events: [on("click", firstClick)],
          for: "field",
          style: { color: "red", fontWeight: "bold" },
        }),
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    expect(button.attributes).toEqual({
      class: "primary",
      disabled: "true",
      for: "field",
    });
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

  it("forwards DOM attributes and updates CSS custom properties", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "svg",
          null,
          createElement("use", {
            "aria-label": "Icon",
            "data-id": "icon",
            style: { "--accent": "red", color: "blue" },
            tabindex: 0,
            "xlink:href": "#icon",
          }),
        ),
      ),
    );

    const svg = container.childNodes[0] as FakeElement;
    const use = svg.childNodes[0] as FakeElement;
    expect(use.attributes).toEqual({
      "aria-label": "Icon",
      "data-id": "icon",
      tabindex: "0",
      "xlink:href": "#icon",
    });
    expect(use.style["--accent"]).toBe("red");
    expect(use.style.color).toBe("blue");

    flushSync(() =>
      root.render(
        createElement(
          "svg",
          null,
          createElement("use", {
            style: { color: "green" },
          }),
        ),
      ),
    );

    expect(use.attributes).toEqual({});
    expect(use.style["--accent"]).toBe("");
    expect(use.style.color).toBe("green");
  });

  it("sets SVG props as attributes", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "svg",
          { class: "icon", viewBox: "0 0 10 10" },
          createElement("path", {
            "fill-rule": "evenodd",
            "stroke-width": 2,
          }),
        ),
      ),
    );

    const svg = container.childNodes[0] as FakeElement;
    const path = svg.childNodes[0] as FakeElement;
    expect(svg.attributes).toEqual({
      class: "icon",
      viewBox: "0 0 10 10",
    });
    expect(path.attributes).toEqual({
      "fill-rule": "evenodd",
      "stroke-width": "2",
    });
  });

  it("sets, updates, and clears unsafe HTML content", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement("article", {
          class: "content",
          unsafeHTML: "<strong>Fig</strong>",
        }),
      ),
    );

    const article = container.childNodes[0] as FakeElement;
    expect(article.attributes).toEqual({ class: "content" });
    expect(article.innerHTML).toBe("<strong>Fig</strong>");
    expect(article.childNodes).toEqual([]);

    flushSync(() =>
      root.render(
        createElement("article", {
          unsafeHTML: "<em>Updated</em>",
        }),
      ),
    );

    expect(article.attributes).toEqual({});
    expect(article.innerHTML).toBe("<em>Updated</em>");

    flushSync(() =>
      root.render(
        createElement("article", null, createElement("span", null, "Child")),
      ),
    );

    expect(article.innerHTML).toBe("Child");
    expect(article.childNodes[0]).toBeInstanceOf(FakeElement);
  });

  it("rejects non-string unsafe HTML values", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    expect(() =>
      flushSync(() =>
        root.render(createElement("article", { unsafeHTML: { html: "" } })),
      ),
    ).toThrow("The unsafeHTML prop must be a string.");
  });

  it("controls input values without resetting selection on equal updates", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement("input", { defaultValue: "Initial", value: "First" }),
      ),
    );

    const input = container.childNodes[0] as FakeElement;
    expect(input.value).toBe("First");
    expect(input.defaultValue).toBe("Initial");
    expect(input.attributes.value).toBe("Initial");

    input.value = "Typed";

    flushSync(() =>
      root.render(
        createElement("input", { defaultValue: "Initial", value: "First" }),
      ),
    );
    expect(input.value).toBe("First");
    expect(input.defaultValue).toBe("Initial");
    expect(input.attributes.value).toBe("Initial");

    input.value = "First";
    flushSync(() =>
      root.render(
        createElement("input", { defaultValue: "Initial", value: "First" }),
      ),
    );
    expect(input.value).toBe("First");
  });

  it("keeps user input when value props are removed", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("input", { value: "First" })));

    const input = container.childNodes[0] as FakeElement;
    input.value = "Typed";

    flushSync(() => root.render(createElement("input", null)));

    expect(input.value).toBe("Typed");
  });

  it("falls back to value attributes for elements without value properties", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("my-slider", null)));

    const slider = container.childNodes[0] as FakeElement;
    delete (slider as unknown as { value?: string }).value;

    flushSync(() => root.render(createElement("my-slider", { value: "5" })));

    expect(slider.attributes.value).toBe("5");
    expect("value" in slider).toBe(false);
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

  it("warns once for silently dropped props in development", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    let firstRenderCount = 0;
    try {
      const app = () =>
        createElement(
          "div",
          null,
          createElement("button", {
            onClick: () => undefined,
            onClickCapture: () => undefined,
            onDoubleClick: () => undefined,
            checked: 1,
            style: { marginTop: 12 },
          } as unknown as Record<string, unknown>),
          createElement("span", {
            style: "color: red",
          } as unknown as Record<string, unknown>),
        );
      flushSync(() => root.render(app()));
      firstRenderCount = errors.length;
      // Re-renders must not repeat the warnings.
      flushSync(() => root.render(app()));
    } finally {
      console.error = originalError;
    }

    // arrayContaining, not an exact array: the dedupe registry is
    // module-level, so other tests' warnings must not couple to this
    // assertion's order or count.
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('events={[on("click", handler)]}'),
        expect.stringContaining(
          'events={[on("click", handler, { capture: true })]}',
        ),
        expect.stringContaining('events={[on("dblclick", handler)]}'),
        expect.stringContaining('"checked" prop received a number'),
        expect.stringContaining("style prop must be an object"),
        expect.stringContaining('style property "marginTop" received a number'),
      ]),
    );
    expect(errors).toHaveLength(firstRenderCount);
    const wrapper = container.childNodes[0] as FakeElement;
    expect((wrapper.childNodes[0] as FakeElement).style.marginTop).toBe(
      undefined,
    );
  });

  it("suggests accurate event names for special React event props", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      flushSync(() =>
        root.render(
          createElement("input", {
            onChange: () => undefined,
            onGotPointerCapture: () => undefined,
            onLostPointerCapture: () => undefined,
            onCapture: () => undefined,
          } as unknown as Record<string, unknown>),
        ),
      );
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual(
      expect.arrayContaining([
        // React's onChange on a text input fires per keystroke, so the
        // behavior-preserving suggestion is on("input"), not on("change").
        expect.stringContaining('events={[on("input", handler)]}'),
        // The trailing "Capture" is part of these event names, not React's
        // capture-phase suffix.
        expect.stringContaining('events={[on("gotpointercapture", handler)]}'),
        expect.stringContaining('events={[on("lostpointercapture", handler)]}'),
        // A bare "onCapture" prop must not strip down to an empty name.
        expect.stringContaining('events={[on("capture", handler)]}'),
      ]),
    );
  });

  it("ignores default values that appear after mount", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("input", null)));

    const input = container.childNodes[0] as FakeElement;
    input.value = "Typed";

    // Form data arriving mid-session must not clobber the user's input.
    flushSync(() =>
      root.render(createElement("input", { defaultValue: "Loaded" })),
    );

    expect(input.value).toBe("Typed");
    expect(input.defaultValue).toBe("Loaded");

    input.checked = true;
    flushSync(() =>
      root.render(
        createElement("input", { defaultChecked: false, defaultValue: "L" }),
      ),
    );
    expect(input.checked).toBe(true);
  });

  it("ignores select default values that appear after mount", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const option = (value: string) =>
      createElement("option", { value }, value.toUpperCase());
    const app = (defaultValue?: string) =>
      createElement(
        "select",
        defaultValue === undefined ? null : { defaultValue },
        option("a"),
        option("b"),
      );

    flushSync(() => root.render(app()));

    const select = container.childNodes[0] as FakeElement;
    const optionA = select.childNodes[0] as FakeElement;
    const optionB = select.childNodes[1] as FakeElement;
    optionA.selected = false;
    optionB.selected = true;

    flushSync(() => root.render(app("a")));

    expect(optionA.selected).toBe(false);
    expect(optionB.selected).toBe(true);
  });

  it("preserves user selection when options are inserted", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const option = (value: string) =>
      createElement("option", { key: value, value }, value);
    const app = (values: string[]) =>
      createElement("select", { defaultValue: "b" }, values.map(option));

    flushSync(() => root.render(app(["a", "b"])));

    const select = container.childNodes[0] as FakeElement;
    const optionB = select.childNodes[1] as FakeElement;
    expect(optionB.selected).toBe(true);

    // The user picks "a"; a later render adds and reorders options.
    const optionA = select.childNodes[0] as FakeElement;
    optionA.selected = true;
    optionB.selected = false;

    flushSync(() => root.render(app(["c", "a", "b"])));

    expect(optionA.selected).toBe(true);
    expect(optionB.selected).toBe(false);
    expect((select.childNodes[0] as FakeElement).selected).toBe(false);
  });

  it("matches implicit option values with pretty-printed text", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "select",
          { value: "Apple" },
          createElement("option", null, "\n  Apple\n"),
          createElement("option", null, "Banana"),
        ),
      ),
    );

    const select = container.childNodes[0] as FakeElement;
    expect((select.childNodes[0] as FakeElement).selected).toBe(true);
    expect((select.childNodes[1] as FakeElement).selected).toBe(false);
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

  it("controls checked without clobbering the default checked attribute", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    // defaultChecked deliberately precedes checked: with a single shared
    // attribute the later prop would win, so this pins order-independence.
    const app = (checked: boolean) =>
      createElement("input", { defaultChecked: true, checked });

    flushSync(() => root.render(app(false)));

    const input = container.childNodes[0] as FakeElement;
    expect(input.checked).toBe(false);
    expect(input.defaultChecked).toBe(true);
    expect(input.attributes.checked).toBe("true");

    // The user toggles; the controlled prop re-asserts on commit without
    // rewriting the element's default — form.reset() must still restore
    // defaultChecked, not the last controlled state.
    input.checked = true;
    flushSync(() => root.render(app(false)));
    expect(input.checked).toBe(false);
    expect(input.defaultChecked).toBe(true);
    expect(input.attributes.checked).toBe("true");

    flushSync(() => root.render(app(true)));
    expect(input.checked).toBe(true);
    expect(input.defaultChecked).toBe(true);
    expect(input.attributes.checked).toBe("true");
  });

  it("leaves the checked attribute untouched for controlled-only inputs", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("input", { checked: true })));

    const input = container.childNodes[0] as FakeElement;
    expect(input.checked).toBe(true);
    expect(input.defaultChecked).toBe(false);
    expect(input.attributes.checked).toBeUndefined();

    flushSync(() => root.render(createElement("input", { checked: false })));
    expect(input.checked).toBe(false);
    expect(input.defaultChecked).toBe(false);
    expect(input.attributes.checked).toBeUndefined();
  });

  it("keeps user checked state when checked props are removed", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("input", { checked: false })));

    const input = container.childNodes[0] as FakeElement;
    input.checked = true;

    flushSync(() => root.render(createElement("input", null)));

    expect(input.checked).toBe(true);
  });

  it("falls back to checked attributes for elements without checked properties", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("my-toggle", null)));

    const toggle = container.childNodes[0] as FakeElement;
    delete (toggle as unknown as { checked?: boolean }).checked;

    flushSync(() => root.render(createElement("my-toggle", { checked: true })));

    expect(toggle.attributes.checked).toBe("true");
    expect("checked" in toggle).toBe(false);
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
    expect(textarea.defaultValue).toBe("");
    expect(textarea.textContent).toBe("");
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
