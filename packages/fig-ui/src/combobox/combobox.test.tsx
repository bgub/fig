// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useCombobox } from "./combobox.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Combobox", () => {
  it("reports edits, clears selection, and lets the caller filter", async () => {
    const inputs: string[] = [];
    const values: Array<string | null> = [];
    const container = await render(
      <Example
        defaultValue="apple"
        onInputValueChange={(value) => inputs.push(value)}
        onValueChange={(value) => values.push(value)}
      />,
    );
    const input = requiredInput(container);

    await type(input, "bl");

    expect(inputs).toEqual(["bl"]);
    expect(values).toEqual([null]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(options(container).map((option) => option.textContent)).toEqual([
      "Blueberry",
    ]);
  });

  it("moves an active descendant and accepts it without moving focus", async () => {
    const container = await render(<Example />);
    const input = requiredInput(container);

    input.focus();
    await keydown(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options(container)[0].id,
    );
    await keydown(input, "Enter");

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Apple");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("submits the selected identity and restores both values on reset", async () => {
    const container = await render(
      <form>
        <Example
          defaultInputValue="Banana"
          defaultValue="banana"
          name="fruit"
        />
      </form>,
    );
    const form = required(container, "form") as HTMLFormElement;
    const input = requiredInput(container);

    await type(input, "app");
    await keydown(input, "ArrowDown");
    await keydown(input, "Enter");
    expect(new FormData(form).get("fruit")).toBe("apple");

    await act(async () => {
      form.reset();
      await Promise.resolve();
    });
    expect(input.value).toBe("Banana");
    expect(new FormData(form).get("fruit")).toBe("banana");
  });
});

const fruits = ["apple", "banana", "blueberry"] as const;

function Example(props: {
  defaultInputValue?: string;
  defaultValue?: (typeof fruits)[number];
  name?: string;
  onInputValueChange?: (value: string) => void;
  onValueChange?: (value: (typeof fruits)[number] | null) => void;
}): FigNode {
  const combobox = useCombobox<(typeof fruits)[number]>(props);
  const matches = fruits.filter((fruit) =>
    fruit.startsWith(combobox.inputValue.toLowerCase()),
  );
  return (
    <>
      <input aria-label="Fruit" data-input="" mix={combobox.input()} />
      <div mix={combobox.popup()}>
        {matches.map((fruit) => (
          <div mix={combobox.option(fruit)}>{capitalize(fruit)}</div>
        ))}
      </div>
      <input mix={combobox.hiddenInput()} />
    </>
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

function requiredInput(container: Element): HTMLInputElement {
  return required(container, "[data-input]") as HTMLInputElement;
}

function options(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

async function keydown(element: HTMLElement, key: string): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    ),
  );
}

function capitalize(value: string): string {
  return value[0]?.toUpperCase() + value.slice(1);
}
