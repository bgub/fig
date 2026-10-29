// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAccordion } from "../accordion/accordion.tsx";
import { useCheckbox } from "../checkbox/checkbox.tsx";
import { useCombobox } from "../combobox/combobox.tsx";
import { usePopover } from "../popover/popover.tsx";
import { useDialog } from "../dialog/dialog.tsx";
import { useMenu } from "../menu/menu.tsx";
import { useToastRegion } from "../toast/toast.tsx";
import { useListbox } from "../listbox/listbox.tsx";
import { useSelect } from "../select/select.tsx";
import { useTooltip } from "../tooltip/tooltip.tsx";

const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  vi.useRealTimers();
  document.body.replaceChildren();
});
async function render(node: FigNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}
function get<T extends HTMLElement = HTMLElement>(
  container: Element,
  selector: string,
): T {
  const node = container.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
async function send(node: HTMLElement, event: Event) {
  await act(() => node.dispatchEvent(event));
}
function click() {
  return new MouseEvent("click", { bubbles: true, cancelable: true });
}
function key(key: string) {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
}

describe("widget state and form contracts", () => {
  it("resets an editable combobox without requiring a submitted hidden input", async () => {
    function Example(): FigNode {
      const combo = useCombobox({ defaultInputValue: "Initial" });
      return (
        <form>
          <input aria-label="Search" mix={combo.input()} />
          <div mix={combo.popup()} />
        </form>
      );
    }
    const container = await render(<Example />);
    const input = get<HTMLInputElement>(container, "input");
    input.value = "Changed";
    await send(input, new Event("input", { bubbles: true }));
    await act(async () => {
      get<HTMLFormElement>(container, "form").reset();
      await Promise.resolve();
    });
    expect(input.value).toBe("Initial");
  });

  it("keeps an unchanged uncontrolled checkbox checked after reset", async () => {
    function Example(): FigNode {
      const checkbox = useCheckbox({ defaultChecked: true });
      return (
        <form>
          <input mix={checkbox.control()} />
        </form>
      );
    }
    const container = await render(<Example />);
    await act(async () => {
      get<HTMLFormElement>(container, "form").reset();
      await Promise.resolve();
    });
    expect(get<HTMLInputElement>(container, "input").checked).toBe(true);
  });

  it("does not reset widget state when native reset is canceled", async () => {
    function Example(): FigNode {
      const checkbox = useCheckbox({ defaultChecked: true });
      return (
        <form mix={on("reset", (e) => e.preventDefault())}>
          <input mix={checkbox.control()} />
        </form>
      );
    }
    const container = await render(<Example />);
    const input = get<HTMLInputElement>(container, "input");
    await act(() => input.click());
    expect(input.checked).toBe(false);
    await act(async () => {
      get<HTMLFormElement>(container, "form").reset();
      await Promise.resolve();
    });
    expect(input.checked).toBe(false);
  });

  it("excludes disabled select values from submission", async () => {
    function Example(): FigNode {
      const select = useSelect({
        defaultValue: "a",
        disabled: true,
        name: "choice",
      });
      return (
        <form>
          <button mix={select.trigger()}>Choose</button>
          <div mix={select.popup()}>
            <div mix={select.option("a")}>A</div>
          </div>
          <input mix={select.hiddenInput()} />
        </form>
      );
    }
    const container = await render(<Example />);
    expect(
      new FormData(get<HTMLFormElement>(container, "form")).has("choice"),
    ).toBe(false);
  });

  it("reports repeated rejected controlled select changes", async () => {
    const changes = vi.fn();
    function Example(): FigNode {
      const select = useSelect({ value: "a", onValueChange: changes });
      return (
        <>
          <button mix={select.trigger()}>Choose</button>
          <div mix={select.popup()}>
            <div mix={select.option("a")}>A</div>
            <div data-b="" mix={select.option("b")}>
              B
            </div>
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    await send(get(container, "[data-b]"), click());
    await send(get(container, "[data-b]"), click());
    expect(changes).toHaveBeenCalledTimes(2);
    expect(get(container, '[aria-selected="true"]').textContent).toBe("A");
  });
});

describe("widget event and collection contracts", () => {
  it("does not activate an accordion trigger whose click was canceled", async () => {
    function Example(): FigNode {
      const accordion = useAccordion();
      return (
        <div mix={accordion.root()}>
          <button
            mix={[
              on("click", (e) => e.preventDefault()),
              accordion.trigger("a"),
            ]}
          >
            A
          </button>
          <section mix={accordion.panel("a")}>Panel</section>
        </div>
      );
    }
    const container = await render(<Example />);
    await send(get(container, "button"), click());
    expect(get(container, "button").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("does not select a listbox option whose click was canceled", async () => {
    function Example(): FigNode {
      const list = useListbox({ defaultValue: ["a"] });
      return (
        <div aria-label="Choices" mix={list.root()}>
          <div mix={list.option("a")}>A</div>
          <div
            data-b=""
            mix={[on("click", (e) => e.preventDefault()), list.option("b")]}
          >
            B
          </div>
        </div>
      );
    }
    const container = await render(<Example />);
    await send(get(container, "[data-b]"), click());
    expect(get(container, '[aria-selected="true"]').textContent).toBe("A");
  });

  it("lets a caller cancel select keyboard selection", async () => {
    function Example(): FigNode {
      const select = useSelect({ defaultValue: "a" });
      return (
        <>
          <button
            mix={[on("keydown", (e) => e.preventDefault()), select.trigger()]}
          >
            Choose
          </button>
          <div mix={select.popup()}>
            <div mix={select.option("a")}>A</div>
            <div mix={select.option("b")}>B</div>
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    await send(get(container, "button"), key("b"));
    expect(get(container, '[aria-selected="true"]').textContent).toBe("A");
  });

  it("repairs selection when its item is removed and only disabled options remain", async () => {
    let remove = () => {};
    function Example(): FigNode {
      const [shown, setShown] = useState(true);
      remove = () => setShown(false);
      const select = useSelect({ defaultValue: "a", name: "choice" });
      return (
        <form>
          <button mix={select.trigger()}>{select.value ?? "None"}</button>
          <div mix={select.popup()}>
            {shown ? <div mix={select.option("a")}>A</div> : null}
            <div mix={select.option("b", { disabled: true })}>B</div>
          </div>
          <input mix={select.hiddenInput()} />
        </form>
      );
    }
    const container = await render(<Example />);
    await act(remove);
    expect(get(container, "button").textContent).toBe("None");
    expect(
      new FormData(get<HTMLFormElement>(container, "form")).get("choice"),
    ).toBe("");
  });

  it("repairs active descendants as options are filtered and emptied", async () => {
    let change = (_values: string[]) => {};
    function Example(): FigNode {
      const [values, setValues] = useState(["a", "b"]);
      change = setValues;
      const combo = useCombobox({ defaultOpen: true });
      return (
        <>
          <input aria-label="Search" mix={combo.input()} />
          <div mix={combo.popup()}>
            {values.map((value) => (
              <div key={value} mix={combo.option(value)}>
                {value}
              </div>
            ))}
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    await act(() => change(["b"]));
    expect(get(container, "input").getAttribute("aria-activedescendant")).toBe(
      get(container, '[role="option"]').id,
    );
    await act(() => change([]));
    expect(get(container, "input").hasAttribute("aria-activedescendant")).toBe(
      false,
    );
  });

  it.each(["listbox", "select", "combobox"])(
    "does not treat a touch drag as %s option hover",
    async (kind) => {
      function Example(): FigNode {
        const list = useListbox({ defaultValue: ["a"] });
        const select = useSelect({ defaultValue: "a", defaultOpen: true });
        const combo = useCombobox({ defaultValue: "a", defaultOpen: true });
        if (kind === "select")
          return (
            <>
              <button mix={select.trigger()}>Choose</button>
              <div mix={select.popup()}>
                <div mix={select.option("a")}>A</div>
                <div data-b="" mix={select.option("b")}>
                  B
                </div>
              </div>
            </>
          );
        if (kind === "combobox")
          return (
            <>
              <input aria-label="Search" mix={combo.input()} />
              <div mix={combo.popup()}>
                <div mix={combo.option("a")}>A</div>
                <div data-b="" mix={combo.option("b")}>
                  B
                </div>
              </div>
            </>
          );
        return (
          <div aria-label="Choices" mix={list.root()}>
            <div mix={list.option("a")}>A</div>
            <div data-b="" mix={list.option("b")}>
              B
            </div>
          </div>
        );
      }
      const container = await render(<Example />);
      const root = get(container, "[aria-activedescendant]");
      const before = root.getAttribute("aria-activedescendant");
      await send(
        get(container, "[data-b]"),
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      expect(root.getAttribute("aria-activedescendant")).toBe(before);
    },
  );
});

describe("widget timer contracts", () => {
  it("ignores tooltip touch hover and cancels pending opens on unmount", async () => {
    const changed = vi.fn();
    function Example(): FigNode {
      const tooltip = useTooltip({ delay: 10, onOpenChange: changed });
      return (
        <>
          <button mix={tooltip.trigger()}>Help</button>
          <div mix={tooltip.tooltip()}>Hint</div>
        </>
      );
    }
    const container = await render(<Example />);
    const trigger = get(container, "button");
    await send(
      trigger,
      new PointerEvent("pointerenter", { pointerType: "touch" }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(changed).not.toHaveBeenCalled();
    await send(
      trigger,
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    const root = roots.pop();
    await act(() => root?.unmount());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("accessible popup names and canceled actions", () => {
  it("names a combobox popup from its label rather than its input value", async () => {
    let rename = () => {};
    function Example(): FigNode {
      const combo = useCombobox({ defaultInputValue: "Apple" });
      const [id, setId] = useState("Find a fruit");
      rename = () => setId("Choose fruit");
      return (
        <>
          <input aria-label={id} mix={combo.input()} />
          <div mix={combo.popup()}>
            <div mix={combo.option("a")}>Apple</div>
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    expect(get(container, '[role="listbox"]').getAttribute("aria-label")).toBe(
      "Find a fruit",
    );
    await act(rename);
    expect(get(container, '[role="listbox"]').getAttribute("aria-label")).toBe(
      "Choose fruit",
    );
  });
  it("preserves an explicit select popup name", async () => {
    function Example(): FigNode {
      const select = useSelect();
      return (
        <>
          <button mix={select.trigger()}>Choose</button>
          <div aria-label="Fruit choices" mix={select.popup()}>
            <div mix={select.option("a")}>Apple</div>
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    expect(
      get(container, '[role="listbox"]').hasAttribute("aria-labelledby"),
    ).toBe(false);
  });
  it.each(["menu", "dialog", "toast"])(
    "honors canceled %s activation",
    async (kind) => {
      const changed = vi.fn();
      function Example(): FigNode {
        const menu = useMenu({ onSelect: changed });
        const dialog = useDialog({ onOpenChange: changed });
        const toast = useToastRegion({ onDismiss: changed });
        const cancel = on("click", (event) => event.preventDefault());
        if (kind === "menu")
          return (
            <>
              <button mix={menu.trigger()}>Open</button>
              <div mix={menu.menu()}>
                <button data-action="" mix={[cancel, menu.item("a")]}>
                  Action
                </button>
              </div>
            </>
          );
        if (kind === "dialog")
          return (
            <>
              <button data-action="" mix={[cancel, dialog.trigger()]}>
                Open
              </button>
              <dialog aria-label="Settings" mix={dialog.dialog()} />
            </>
          );
        return (
          <div mix={toast.region()}>
            <div mix={toast.toast("a", { duration: null })}>
              Saved
              <button data-action="" mix={[cancel, toast.dismiss("a")]}>
                Dismiss
              </button>
            </div>
          </div>
        );
      }
      const container = await render(<Example />);
      await send(get(container, "[data-action]"), click());
      expect(changed).not.toHaveBeenCalled();
    },
  );
});

it.each(["native", "reference", "popup override"])(
  "preserves %s Combobox naming",
  async (kind) => {
    function Example(): FigNode {
      const combo = useCombobox({ defaultInputValue: "Typed value" });
      return (
        <>
          <label for="named-input" id="named-label">
            Fruit search
          </label>
          <input
            id="named-input"
            aria-labelledby={kind === "reference" ? "named-label" : undefined}
            mix={combo.input()}
          />
          <div
            aria-label={kind === "popup override" ? "Suggestions" : undefined}
            mix={combo.popup()}
          />
        </>
      );
    }
    const container = await render(<Example />);
    const popup = get(container, '[role="listbox"]');
    if (kind === "reference")
      expect(popup.getAttribute("aria-labelledby")).toBe("named-label");
    else
      expect(popup.getAttribute("aria-label")).toBe(
        kind === "native" ? "Fruit search" : "Suggestions",
      );
  },
);

it("resets a checkbox even when the form reset handler rerenders its owner", async () => {
  function Example(): FigNode {
    const checkbox = useCheckbox({ defaultChecked: true });
    const [count, setCount] = useState(0);
    return (
      <form data-count={count} mix={on("reset", () => setCount(count + 1))}>
        <input mix={checkbox.control()} />
      </form>
    );
  }
  const container = await render(<Example />);
  const input = get<HTMLInputElement>(container, "input");
  await act(() => input.click());
  expect(input.checked).toBe(false);
  await act(async () => {
    get<HTMLFormElement>(container, "form").reset();
    await Promise.resolve();
  });
  expect(input.checked).toBe(true);
  expect(input.hasAttribute("data-checked")).toBe(true);
});

it.each(["popover", "dialog", "select"])(
  "preserves an authored disabled %s trigger",
  async (kind) => {
    const changed = vi.fn();
    let enable = () => {};
    function Example(): FigNode {
      const [disabled, setDisabled] = useState(true);
      enable = () => setDisabled(false);
      const popover = usePopover({ onOpenChange: changed });
      const dialog = useDialog({ onOpenChange: changed });
      const select = useSelect({ onOpenChange: changed });
      if (kind === "dialog")
        return (
          <>
            <button disabled={disabled} mix={dialog.trigger()}>
              Open
            </button>
            <dialog aria-label="Settings" mix={dialog.dialog()} />
          </>
        );
      if (kind === "select")
        return (
          <>
            <button disabled={disabled} mix={select.trigger()}>
              Choose
            </button>
            <div mix={select.popup()}>
              <div mix={select.option("a")}>A</div>
            </div>
          </>
        );
      return (
        <>
          <button disabled={disabled} mix={popover.trigger()}>
            Open
          </button>
          <div mix={popover.popover()}>Contents</div>
        </>
      );
    }
    const container = await render(<Example />);
    const trigger = get<HTMLButtonElement>(container, "button");
    expect(trigger.disabled).toBe(true);
    await act(() => trigger.click());
    expect(changed).not.toHaveBeenCalled();
    await act(enable);
    expect(trigger.disabled).toBe(false);
    await act(() => trigger.click());
    expect(changed).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  "retains sequential accordion toggles in one batch, same item: %s",
  async (sameItem) => {
    function Example(): FigNode {
      const accordion = useAccordion({ multiple: true });
      return (
        <div mix={accordion.root()}>
          <button data-a="" mix={accordion.trigger("a")}>
            A
          </button>
          <button data-b="" mix={accordion.trigger("b")}>
            B
          </button>
          <section mix={accordion.panel("a")}>First</section>
          <section mix={accordion.panel("b")}>Second</section>
        </div>
      );
    }
    const container = await render(<Example />);
    const a = get<HTMLButtonElement>(container, "[data-a]");
    const b = get<HTMLButtonElement>(container, "[data-b]");
    await act(() => {
      a.click();
      (sameItem ? a : b).click();
    });
    expect(a.getAttribute("aria-expanded")).toBe(sameItem ? "false" : "true");
    expect(b.getAttribute("aria-expanded")).toBe(sameItem ? "false" : "true");
  },
);
