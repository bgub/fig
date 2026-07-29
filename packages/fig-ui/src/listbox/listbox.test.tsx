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
