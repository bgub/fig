// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
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

  it("does not select an option while confirming IME composition", async () => {
    const changes: Array<string | null> = [];
    const container = await render(
      <Example onValueChange={(value) => changes.push(value)} />,
    );
    const input = requiredInput(container);
    await keydown(input, "ArrowDown");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => input.dispatchEvent(event));
    expect(changes).toEqual([]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps native button options out of sequential focus", async () => {
    function Buttons(): FigNode {
      const combo = useCombobox();
      return (
        <>
          <input aria-label="Fruit" mix={combo.input()} />
          <div mix={combo.popup()}>
            <button mix={combo.option("apple")}>Apple</button>
          </div>
        </>
      );
    }
    const container = await render(<Buttons />);
    expect(options(container)[0].tabIndex).toBe(-1);
    expect((options(container)[0] as HTMLButtonElement).type).toBe("button");
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

it("renders inline results in document flow and keeps controlled results open", async () => {
  function Inline(): FigNode {
    const combo = useCombobox({ inline: true, open: true });
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          <div mix={combo.option("apple")}>Apple</div>
        </div>
      </>
    );
  }
  const container = await render(<Inline />);
  const input = requiredInput(container);
  const list = required(container, '[role="listbox"]');
  expect(list.hasAttribute("popover")).toBe(false);
  expect(list.hidden).toBe(false);
  expect(list.style.getPropertyValue("position-anchor")).toBe("");
  expect(input.style.getPropertyValue("anchor-name")).toBe("");
  await keydown(input, "Enter");
  expect(input.value).toBe("Apple");
  expect(list.hidden).toBe(false);
  expect(input.getAttribute("aria-expanded")).toBe("true");
});

it("hides a closed inline list and opens it from the input", async () => {
  let close: (() => void) | undefined;
  function Inline(): FigNode {
    const combo = useCombobox({ inline: true });
    close = () => combo.setOpen(false);
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          <div mix={combo.option("apple")}>Apple</div>
        </div>
      </>
    );
  }
  const container = await render(<Inline />);
  const input = requiredInput(container);
  const list = required(container, '[role="listbox"]');
  expect(list.hidden).toBe(true);
  await keydown(input, "ArrowDown");
  expect(list.hidden).toBe(false);
  await keydown(input, "Escape");
  expect(list.hidden).toBe(false);
  await act(() => close?.());
  expect(list.hidden).toBe(true);
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
});

it("removes anchor styles when changing a popup to inline", async () => {
  function ExampleMode({ inline }: { inline: boolean }): FigNode {
    const combo = useCombobox({ inline, open: true });
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()} />
      </>
    );
  }
  const container = await render(<ExampleMode inline={false} />);
  const input = requiredInput(container);
  const list = required(container, '[role="listbox"]');
  expect(input.style.getPropertyValue("anchor-name")).not.toBe("");
  await act(() => roots.at(-1)?.render(<ExampleMode inline />));
  expect(list.hasAttribute("popover")).toBe(false);
  expect(list.hidden).toBe(false);
  expect(list.style.getPropertyValue("position-anchor")).toBe("");
  expect(input.style.getPropertyValue("anchor-name")).toBe("");
});

it("clears inline hidden state when switching to an open popup", async () => {
  function ExampleMode({
    inline,
    open,
  }: {
    inline: boolean;
    open: boolean;
  }): FigNode {
    const combo = useCombobox({ inline, open });
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()} />
      </>
    );
  }
  const container = await render(<ExampleMode inline open={false} />);
  const list = required(container, '[role="listbox"]');
  expect(list.hidden).toBe(true);
  await act(() => roots.at(-1)?.render(<ExampleMode inline={false} open />));
  expect(list.hidden).toBe(false);
  expect(list.getAttribute("popover")).toBe("auto");
});

it.each(["disabled", "readonly"])(
  "does not select through a list when the input is %s",
  async (constraint) => {
    const changes: string[] = [];
    function Constrained(): FigNode {
      const combo = useCombobox<string>({
        inline: true,
        open: true,
        onValueChange: (value) => {
          if (value !== null) changes.push(value);
        },
      });
      return (
        <>
          <fieldset>
            <input
              aria-label="Fruit"
              data-input=""
              disabled={constraint === "disabled"}
              readonly={constraint === "readonly"}
              mix={combo.input()}
            />
          </fieldset>
          <div mix={combo.popup()}>
            <div mix={combo.option("apple")}>Apple</div>
          </div>
        </>
      );
    }
    const container = await render(<Constrained />);
    const input = requiredInput(container);
    if (constraint === "readonly") expect(input.readOnly).toBe(true);
    await act(() => options(container)[0].click());
    expect(changes).toEqual([]);
    expect(input.value).toBe("");
  },
);

it("restores an edit canceled by an earlier input handler", async () => {
  const changes: string[] = [];
  function Canceled(): FigNode {
    const combo = useCombobox({
      defaultInputValue: "Apple",
      onInputValueChange: (value) => changes.push(value),
    });
    return (
      <>
        <input
          aria-label="Fruit"
          data-input=""
          mix={[on("input", (event) => event.preventDefault()), combo.input()]}
        />
        <div mix={combo.popup()} />
      </>
    );
  }
  const container = await render(<Canceled />);
  const input = requiredInput(container);
  await act(() => {
    input.value = "Banana";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: true }),
    );
  });
  expect(changes).toEqual([]);
  expect(input.value).toBe("Apple");
});

it.each(["disabled", "readonly"])(
  "re-enables selection after removing the native %s constraint",
  async (constraint) => {
    const changes: string[] = [];
    function Dynamic({ locked }: { locked: boolean }): FigNode {
      const combo = useCombobox<string>({
        inline: true,
        open: true,
        onValueChange: (value) => {
          if (value !== null) changes.push(value);
        },
      });
      return (
        <>
          <input
            aria-label="Fruit"
            data-input=""
            disabled={locked && constraint === "disabled"}
            readonly={locked && constraint === "readonly"}
            mix={combo.input()}
          />
          <div mix={combo.popup()}>
            <div mix={combo.option("apple")}>Apple</div>
          </div>
        </>
      );
    }
    const container = await render(<Dynamic locked />);
    await act(() => options(container)[0].click());
    expect(changes).toEqual([]);
    await act(() => roots.at(-1)?.render(<Dynamic locked={false} />));
    await act(() => options(container)[0].click());
    expect(changes).toEqual(["apple"]);
    expect(requiredInput(container).value).toBe("Apple");
  },
);

it("consumes Enter on a highlighted readonly option without changing value or submitting", async () => {
  const changes: string[] = [];
  function ReadOnly(): FigNode {
    const combo = useCombobox<string>({
      inline: true,
      open: true,
      readOnly: true,
      onValueChange: (value) => {
        if (value !== null) changes.push(value);
      },
    });
    return (
      <form>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          <div mix={combo.option("apple")}>Apple</div>
        </div>
      </form>
    );
  }
  const container = await render(<ReadOnly />);
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  await act(() => requiredInput(container).dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(changes).toEqual([]);
});

it("scrolls keyboard highlights into view after opening, without scrolling pointer highlights", async () => {
  function Scrollable(): FigNode {
    const combo = useCombobox();
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          {["apple", "banana"].map((value) => (
            <div mix={combo.option(value)}>{value}</div>
          ))}
        </div>
      </>
    );
  }
  const container = await render(<Scrollable />);
  const input = requiredInput(container);
  const list = required(container, '[role="listbox"]');
  const [apple, banana] = options(container);
  const calls: Array<{
    value: string | null;
    hidden: boolean;
    options: ScrollIntoViewOptions | boolean | undefined;
  }> = [];
  for (const node of [apple, banana])
    node.scrollIntoView = (options) => {
      calls.push({
        value: node.textContent,
        hidden: Boolean(list.hidden),
        options,
      });
    };
  input.focus();
  await keydown(input, "ArrowDown");
  expect(calls).toEqual([
    {
      value: "apple",
      hidden: false,
      options: { block: "nearest", inline: "nearest" },
    },
  ]);
  expect(document.activeElement).toBe(input);
  await keydown(input, "ArrowDown");
  expect(calls.at(-1)?.value).toBe("banana");
  calls.length = 0;
  await act(() =>
    apple.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    ),
  );
  expect(input.getAttribute("aria-activedescendant")).toBe(apple.id);
  expect(calls).toEqual([]);
});

it("scrolls a repeated keyboard highlight even when the only option stays active", async () => {
  function Single(): FigNode {
    const combo = useCombobox({ inline: true, open: true });
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          <div mix={combo.option("apple")}>Apple</div>
        </div>
      </>
    );
  }
  const container = await render(<Single />);
  let calls = 0;
  options(container)[0].scrollIntoView = () => {
    calls += 1;
  };
  await keydown(requiredInput(container), "ArrowDown");
  await keydown(requiredInput(container), "ArrowDown");
  expect(calls).toBe(2);
});

it("reports repeated controlled selection requests without retaining refused identities", async () => {
  const values: Array<string | null> = [];
  const inputs: string[] = [];
  function Controlled(): FigNode {
    const combo = useCombobox<string>({
      inline: true,
      open: true,
      value: null,
      inputValue: "",
      onValueChange: (value) => values.push(value),
      onInputValueChange: (value) => inputs.push(value),
    });
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          <div mix={combo.option("apple")}>Apple</div>
        </div>
      </>
    );
  }
  const container = await render(<Controlled />);
  const option = options(container)[0];
  await act(() => {
    option.click();
    option.click();
  });
  expect(values).toEqual(["apple", "apple"]);
  expect(inputs).toEqual(["Apple", "Apple"]);
  expect(requiredInput(container).value).toBe("");
});

it("does not re-emit accepted uncontrolled selection in the same batch", async () => {
  const values: Array<string | null> = [];
  const inputs: string[] = [];
  function Uncontrolled(): FigNode {
    const combo = useCombobox<string>({
      inline: true,
      open: true,
      onValueChange: (value) => values.push(value),
      onInputValueChange: (value) => inputs.push(value),
    });
    return (
      <>
        <input aria-label="Fruit" data-input="" mix={combo.input()} />
        <div mix={combo.popup()}>
          <div mix={combo.option("apple")}>Apple</div>
        </div>
      </>
    );
  }
  const container = await render(<Uncontrolled />);
  const option = options(container)[0];
  await act(() => {
    option.click();
    option.click();
  });
  expect(values).toEqual(["apple"]);
  expect(inputs).toEqual(["Apple"]);
  expect(requiredInput(container).value).toBe("Apple");
});
