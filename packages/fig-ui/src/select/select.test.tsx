// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { type SelectValueChangeHandler, useSelect } from "./select.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Select", () => {
  it("selects the first enabled option and wires a listbox popup", async () => {
    const container = await render(<Example />);
    const trigger = required(container, "[data-trigger]");
    const popup = required(container, '[role="listbox"]');
    const [apple] = options(container);

    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-controls")).toBe(popup.id);
    expect(popup.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(apple.getAttribute("aria-selected")).toBe("true");
    expect(trigger.textContent).toBe("apple");
  });

  it("moves active descendant with arrows and selects with Enter", async () => {
    const changes: string[] = [];
    const container = await render(
      <Example onValueChange={(value) => changes.push(value ?? "none")} />,
    );
    const trigger = required(container, "[data-trigger]");

    await keydown(trigger, "ArrowDown");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      options(container)[1].id,
    );

    await keydown(trigger, "Enter");
    expect(trigger.textContent).toBe("banana");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(changes.at(-1)).toBe("banana");
  });

  it("skips disabled options during typeahead", async () => {
    const container = await render(<Example disabledBanana={true} />);
    const trigger = required(container, "[data-trigger]");

    await keydown(trigger, "b");

    expect(trigger.textContent).toBe("blueberry");
  });

  it("submits and resets its uncontrolled selection", async () => {
    const container = await render(
      <form>
        <Example defaultValue="banana" name="fruit" />
      </form>,
    );
    const form = required(container, "form") as HTMLFormElement;
    const trigger = required(container, "[data-trigger]");

    await click(trigger);
    await click(options(container)[0]);
    expect(new FormData(form).get("fruit")).toBe("apple");

    await act(async () => {
      form.reset();
      await Promise.resolve();
    });
    expect(new FormData(form).get("fruit")).toBe("banana");
  });
});

function Example(props: {
  defaultValue?: string;
  disabledBanana?: boolean;
  name?: string;
  onValueChange?: SelectValueChangeHandler<string>;
}): FigNode {
  const select = useSelect<string>(props);
  return (
    <>
      <button data-trigger="" mix={select.trigger()}>
        {select.value ?? "Choose"}
      </button>
      <div mix={select.popup()}>
        <div mix={select.option("apple")}>Apple</div>
        <div mix={select.option("banana", { disabled: props.disabledBanana })}>
          Banana
        </div>
        <div mix={select.option("blueberry")}>Blueberry</div>
      </div>
      <input mix={select.hiddenInput()} />
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

function options(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

async function click(element: HTMLElement): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    ),
  );
}

async function keydown(element: HTMLElement, key: string): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    ),
  );
}
