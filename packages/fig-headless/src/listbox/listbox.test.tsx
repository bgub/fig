// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { type ListboxValueChangeHandler, useListbox } from "./listbox.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Listbox", () => {
  it("ignores typeahead keystrokes during IME composition", async () => {
    const container = await render(<Example defaultValue={["apple"]} />);
    const trigger = required(container, "[data-root]");
    await act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(options(container)[0].getAttribute("aria-selected")).toBe("true");
    expect(options(container)[1].getAttribute("aria-selected")).toBe("false");
  });

  it("keeps a multi-character typeahead search across selection renders", async () => {
    const container = await render(<Example />);
    const trigger = required(container, "[data-root]");
    await keydown(trigger, "b");
    await keydown(trigger, "l");
    expect(
      options(container)
        .find((option) => option.getAttribute("aria-selected") === "true")
        ?.textContent?.toLowerCase(),
    ).toBe("blueberry");
  });

  it("does not turn native button options into form submit controls", async () => {
    function Buttons(): FigNode {
      const listbox = useListbox();
      return (
        <div aria-label="Fruit" mix={listbox.root()}>
          <button mix={listbox.option("apple")}>Apple</button>
        </div>
      );
    }
    const container = await render(<Buttons />);
    expect((options(container)[0] as HTMLButtonElement).type).toBe("button");
  });

  it("owns active-descendant navigation and single selection", async () => {
    const changes: string[][] = [];
    const container = await render(
      <Example
        defaultValue={["apple"]}
        disabledBanana={true}
        onValueChange={(values) => changes.push([...values])}
      />,
    );
    const root = required(container, "[data-root]");
    const [apple, banana, blueberry] = options(container);

    expect(root.getAttribute("role")).toBe("listbox");
    expect(root.getAttribute("aria-label")).toBe("Fruit");
    expect(root.getAttribute("aria-activedescendant")).toBe(apple.id);
    expect(apple.getAttribute("aria-selected")).toBe("true");
    expect(banana.getAttribute("aria-disabled")).toBe("true");

    await keydown(root, "ArrowDown");

    expect(root.getAttribute("aria-activedescendant")).toBe(blueberry.id);
    expect(blueberry.getAttribute("aria-selected")).toBe("true");
    expect(changes).toEqual([["blueberry"]]);

    await keydown(root, "a");
    expect(apple.getAttribute("aria-selected")).toBe("true");
  });

  it("separates highlighting from selection in a multi-select listbox", async () => {
    const changes: string[][] = [];
    const container = await render(
      <Example
        defaultValue={["apple"]}
        multiple={true}
        onValueChange={(values) => changes.push([...values])}
      />,
    );
    const root = required(container, "[data-root]");
    const [apple, banana] = options(container);

    expect(root.getAttribute("aria-multiselectable")).toBe("true");
    await keydown(root, "ArrowDown");
    expect(root.getAttribute("aria-activedescendant")).toBe(banana.id);
    expect(banana.getAttribute("aria-selected")).toBe("false");

    await keydown(root, " ");
    expect(banana.getAttribute("aria-selected")).toBe("true");
    await click(apple);
    expect(apple.getAttribute("aria-selected")).toBe("false");
    expect(changes).toEqual([["apple", "banana"], ["banana"]]);
  });

  it("allows navigation but prevents selection when read-only", async () => {
    const changes: string[][] = [];
    const container = await render(
      <Example
        defaultValue={["apple"]}
        onValueChange={(values) => changes.push([...values])}
        readOnly={true}
      />,
    );
    const root = required(container, "[data-root]");
    const [apple, banana] = options(container);

    expect(root.getAttribute("aria-readonly")).toBe("true");
    await keydown(root, "ArrowDown");
    expect(root.getAttribute("aria-activedescendant")).toBe(banana.id);
    expect(apple.getAttribute("aria-selected")).toBe("true");
    expect(banana.getAttribute("aria-selected")).toBe("false");

    expect(await click(banana)).toBe(false);
    expect(changes).toEqual([]);
  });

  it("reconciles a canceled controlled change", async () => {
    const changes: Array<{ canceled: boolean; values: readonly string[] }> = [];
    const container = await render(
      <Example
        onValueChange={(values, details) => {
          details.cancel();
          changes.push({ canceled: details.isCanceled, values });
        }}
        value={["apple"]}
      />,
    );
    const root = required(container, "[data-root]");
    const [apple, banana] = options(container);

    await keydown(root, "ArrowDown");

    expect(apple.getAttribute("aria-selected")).toBe("true");
    expect(banana.getAttribute("aria-selected")).toBe("false");
    expect(changes).toEqual([{ canceled: true, values: ["banana"] }]);
  });
});

function Example(props: {
  defaultValue?: readonly string[];
  disabledBanana?: boolean;
  multiple?: boolean;
  onValueChange?: ListboxValueChangeHandler<string>;
  readOnly?: boolean;
  value?: readonly string[];
}): FigNode {
  const listbox = useListbox<string>(props);
  return (
    <div aria-label="Fruit" data-root="" mix={listbox.root()}>
      <div mix={listbox.option("apple")}>Apple</div>
      <div
        mix={listbox.option("banana", {
          disabled: props.disabledBanana,
        })}
      >
        Banana
      </div>
      <div mix={listbox.option("blueberry")}>Blueberry</div>
    </div>
  );
}

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}

function required(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

function options(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

async function click(element: HTMLElement): Promise<boolean> {
  let result = true;
  await act(() => {
    result = element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
  });
  return result;
}

async function keydown(element: HTMLElement, key: string): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    ),
  );
}

it("bases batched controlled multi-selection requests on the rendered value", async () => {
  const changes: string[][] = [];
  const container = await render(
    <Example
      multiple
      value={[]}
      onValueChange={(values) => changes.push([...values])}
    />,
  );
  const [apple, banana] = options(container);
  await act(() => {
    apple.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    banana.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
  });
  expect(changes).toEqual([["apple"], ["banana"]]);
  expect(
    options(container).every(
      (option) => option.getAttribute("aria-selected") === "false",
    ),
  ).toBe(true);
});

it("does not let a disabled nested listbox navigate its parent", async () => {
  const changes: string[][] = [];
  function Nested(): FigNode {
    const outer = useListbox<string>({
      onValueChange: (values) => changes.push([...values]),
    });
    const inner = useListbox({ disabled: true });
    return (
      <div aria-label="Outer" mix={outer.root()}>
        <div mix={outer.option("apple")}>
          Apple
          <div aria-label="Inner" data-inner="" mix={inner.root()}>
            <div mix={inner.option("child")}>Child</div>
          </div>
        </div>
        <div mix={outer.option("banana")}>Banana</div>
      </div>
    );
  }
  const container = await render(<Nested />);
  await keydown(required(container, "[data-inner]"), "ArrowDown");
  expect(changes).toEqual([]);
});

it("still accumulates accepted batched uncontrolled multi-selection", async () => {
  const changes: string[][] = [];
  const container = await render(
    <Example multiple onValueChange={(values) => changes.push([...values])} />,
  );
  const [apple, banana] = options(container);
  await act(() => {
    apple.click();
    banana.click();
  });
  expect(changes).toEqual([["apple"], ["apple", "banana"]]);
  expect(apple.getAttribute("aria-selected")).toBe("true");
  expect(banana.getAttribute("aria-selected")).toBe("true");
});
