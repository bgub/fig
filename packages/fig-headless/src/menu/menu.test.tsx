// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type MenuOpenChangeHandler,
  type MenuSelectHandler,
  useMenu,
} from "./menu.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

// The top layer, light dismiss, and Escape belong to the popover underneath,
// which happy-dom does not implement, so those are covered in the browser
// suite. What is covered here is the part the menu owns: focus and keys.
describe("Menu", () => {
  it("names the menu from its trigger and marks the relationship", async () => {
    const container = await renderMenu({});
    const trigger = requiredElement(container, "[data-trigger]");
    const menu = requiredElement(container, '[role="menu"]');

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(items(container).every((item) => item.tabIndex === -1)).toBe(true);
  });

  it("follows a caller-owned trigger id", async () => {
    function CustomIdMenu(): FigNode {
      const menu = useMenu();
      return (
        <>
          <button id="actions-trigger" mix={menu.trigger()}>
            Actions
          </button>
          <div data-menu="" mix={menu.menu()}>
            <button mix={menu.item("rename")}>Rename</button>
          </div>
        </>
      );
    }

    const container = await render(<CustomIdMenu />);
    expect(
      requiredElement(container, '[role="menu"]').getAttribute(
        "aria-labelledby",
      ),
    ).toBe("actions-trigger");
  });

  it("follows a changed custom trigger id", async () => {
    let rename = () => {};
    function RenamedMenu(): FigNode {
      const menu = useMenu();
      const [id, setId] = useState("before");
      rename = () => setId("after");
      return (
        <>
          <button id={id} mix={menu.trigger()}>
            Actions
          </button>
          <div mix={menu.menu()}>
            <button mix={menu.item("edit")}>Edit</button>
          </div>
        </>
      );
    }
    const container = await render(<RenamedMenu />);
    await act(rename);
    expect(
      requiredElement(container, '[role="menu"]').getAttribute(
        "aria-labelledby",
      ),
    ).toBe("after");
  });

  it("preserves an authored label while switching back to automatic labelling", async () => {
    let advance = () => {};
    function ChangingLabel(): FigNode {
      const widget = useMenu();
      const [step, setStep] = useState(0);
      advance = () => setStep(step + 1);
      return (
        <>
          <span id="external">External name</span>
          <button id={`trigger-${step}`} mix={widget.trigger()}>
            Actions
          </button>
          <div
            aria-labelledby={step === 1 ? "external" : undefined}
            mix={widget.menu()}
          >
            <button mix={widget.item("edit")}>Edit</button>
          </div>
        </>
      );
    }
    const container = await render(<ChangingLabel />);
    const popup = requiredElement(container, '[role="menu"]');
    expect(popup.getAttribute("aria-labelledby")).toBe("trigger-0");
    await act(advance);
    expect(popup.getAttribute("aria-labelledby")).toBe("external");
    await act(advance);
    expect(popup.getAttribute("aria-labelledby")).toBe("trigger-2");
  });

  it("moves focus to the first item when opened downward", async () => {
    const container = await renderMenu({});
    const trigger = requiredElement(container, "[data-trigger]");

    trigger.focus();
    await keydown(trigger, "ArrowDown");

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items(container)[0]);
  });

  it("moves focus to the last item when opened upward", async () => {
    const container = await renderMenu({});
    const trigger = requiredElement(container, "[data-trigger]");

    trigger.focus();
    await keydown(trigger, "ArrowUp");

    expect(document.activeElement).toBe(items(container).at(-1));
  });

  it("walks items with arrows, wrapping at both ends", async () => {
    const container = await openMenu(await renderMenu({}));
    const [rename, duplicate, remove] = items(container);

    expect(document.activeElement).toBe(rename);
    await keydown(rename, "ArrowDown");
    expect(document.activeElement).toBe(duplicate);

    await keydown(duplicate, "End");
    expect(document.activeElement).toBe(remove);

    await keydown(remove, "ArrowDown");
    expect(document.activeElement).toBe(rename);

    await keydown(rename, "ArrowUp");
    expect(document.activeElement).toBe(remove);
  });

  it("jumps to an item by typing", async () => {
    const container = await openMenu(await renderMenu({}));
    const [rename, duplicate] = items(container);

    await keydown(rename, "d");

    expect(document.activeElement).toBe(duplicate);
  });

  it.each(["altKey", "ctrlKey", "metaKey"])(
    "does not typeahead for %s shortcuts",
    async (modifier) => {
      const container = await openMenu(await renderMenu({}));
      const [rename] = items(container);
      await act(() =>
        rename.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "d",
            [modifier]: true,
          }),
        ),
      );
      expect(document.activeElement).toBe(rename);
    },
  );

  it("still accepts uppercase typeahead with Shift", async () => {
    const container = await openMenu(await renderMenu({}));
    const [rename, duplicate] = items(container);
    await act(() =>
      rename.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "D",
          shiftKey: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(duplicate);
  });

  it("does not move focus during text composition", async () => {
    const container = await openMenu(await renderMenu({}));
    const [rename] = items(container);
    await act(() =>
      rename.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "d",
          isComposing: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(rename);
  });

  it("steps through items sharing a first letter when it repeats", async () => {
    // Successive keystrokes extend the search until the pause resets it, so a
    // repeat is the one case that means "the next match" rather than "dr".
    const container = await openMenu(await renderMenu({}));
    const [rename, , remove] = items(container);

    await keydown(rename, "r");
    expect(document.activeElement).toBe(rename);

    await keydown(rename, "r");
    expect(document.activeElement).toBe(remove);
  });

  it("activates an item, reports it, and closes", async () => {
    const selections: Array<{ event: string | null; value: string }> = [];
    const container = await openMenu(
      await renderMenu({
        onSelect: (value, details) =>
          selections.push({ event: details.event?.type ?? null, value }),
      }),
    );
    const trigger = requiredElement(container, "[data-trigger]");

    await keydown(items(container)[0], "Enter");

    expect(selections).toEqual([{ event: "keydown", value: "rename" }]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Focus returns to the trigger, since the platform does not restore it
    // for a popover the way it does for a modal dialog.
    expect(document.activeElement).toBe(trigger);
  });

  it("activates on click and lets a handler keep the menu open", async () => {
    const selections: string[] = [];
    const container = await openMenu(
      await renderMenu({
        onSelect: (value, details) => {
          selections.push(value);
          details.cancel();
        },
      }),
    );
    const trigger = requiredElement(container, "[data-trigger]");

    await click(items(container)[1]);

    expect(selections).toEqual(["duplicate"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps controlled checkbox and radio items open while they change", async () => {
    function CheckedMenu(): FigNode {
      const [minimap, setMinimap] = useState(false);
      const [sort, setSort] = useState<"date" | "name">("name");
      const menu = useMenu<"date" | "minimap" | "name">({
        onSelect: (value) => {
          if (value === "minimap") setMinimap((checked) => !checked);
          else setSort(value);
        },
      });
      return (
        <>
          <button data-trigger="" mix={menu.trigger()}>
            View
          </button>
          <div mix={menu.menu()}>
            <button
              data-checkbox=""
              mix={menu.checkboxItem("minimap", { checked: minimap })}
            >
              Minimap
            </button>
            <button mix={menu.radioItem("name", { checked: sort === "name" })}>
              Name
            </button>
            <button mix={menu.radioItem("date", { checked: sort === "date" })}>
              Date
            </button>
          </div>
        </>
      );
    }
    const container = await render(<CheckedMenu />);
    await openMenu(container);
    const trigger = requiredElement(container, "[data-trigger]");
    const checkbox = requiredElement(container, "[data-checkbox]");

    expect(checkbox.getAttribute("role")).toBe("menuitemcheckbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    await keydown(checkbox, "Enter");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const radio = requiredElement(
      container,
      '[role="menuitemradio"]:last-child',
    );
    await click(radio);
    expect(radio.getAttribute("aria-checked")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("lets an action opt out of closing", async () => {
    const selections: string[] = [];
    function PersistentMenu(): FigNode {
      const menu = useMenu<string>({
        onSelect: (value) => selections.push(value),
      });
      return (
        <>
          <button data-trigger="" mix={menu.trigger()}>
            Actions
          </button>
          <div mix={menu.menu()}>
            <button mix={menu.item("pin", { closeOnSelect: false })}>
              Pin
            </button>
          </div>
        </>
      );
    }
    const container = await openMenu(await render(<PersistentMenu />));

    await keydown(items(container)[0], "Enter");

    expect(selections).toEqual(["pin"]);
    expect(
      requiredElement(container, "[data-trigger]").getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });

  it("keeps disabled items focusable without activating them", async () => {
    const selections: string[] = [];
    const container = await openMenu(
      await renderMenu({
        disabledValue: "remove",
        onSelect: (value) => selections.push(value),
      }),
    );
    const [, duplicate, remove] = items(container);

    expect(remove.getAttribute("aria-disabled")).toBe("true");

    await keydown(duplicate, "ArrowDown");
    expect(document.activeElement).toBe(remove);

    await keydown(remove, "Enter");
    const blocked = await click(remove);

    expect(selections).toEqual([]);
    expect(blocked.defaultPrevented).toBe(true);
  });

  it("closes on Tab and returns focus to the trigger", async () => {
    const container = await openMenu(await renderMenu({}));
    const trigger = requiredElement(container, "[data-trigger]");

    await keydown(items(container)[0], "Tab");

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("reports opening through the popover's own handler", async () => {
    const changes: boolean[] = [];
    const container = await renderMenu({
      onOpenChange: (open) => changes.push(open),
    });

    await keydown(requiredElement(container, "[data-trigger]"), "ArrowDown");

    expect(changes).toEqual([true]);
  });
});

interface ExampleMenuProps {
  disabledValue?: string;
  onOpenChange?: MenuOpenChangeHandler;
  onSelect?: MenuSelectHandler<string>;
}

function ExampleMenu(props: ExampleMenuProps): FigNode {
  const menu = useMenu<string>({
    onOpenChange: props.onOpenChange,
    onSelect: props.onSelect,
  });

  return (
    <div>
      <button data-trigger="" mix={menu.trigger()}>
        Actions
      </button>
      <div data-menu="" mix={menu.menu()}>
        {(["rename", "duplicate", "remove"] as const).map((value) => (
          <button
            mix={menu.item(value, {
              disabled: props.disabledValue === value,
            })}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

async function renderMenu(props: ExampleMenuProps): Promise<HTMLElement> {
  return render(<ExampleMenu {...props} />);
}

/** Opens through the trigger, which is how focus reaches the first item. */
async function openMenu(container: HTMLElement): Promise<HTMLElement> {
  const trigger = requiredElement(container, "[data-trigger]");
  trigger.focus();
  await keydown(trigger, "ArrowDown");
  return container;
}

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}

function items(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function requiredElement(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

async function click(element: HTMLElement): Promise<MouseEvent> {
  const event = new MouseEvent("click", {
    bubbles: true,
    button: 0,
    cancelable: true,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

async function keydown(
  element: HTMLElement,
  key: string,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

it("ignores IME confirmation on a closed menu trigger", async () => {
  const container = await renderMenu({});
  const trigger = requiredElement(container, "[data-trigger]");
  await act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("ignores IME confirmation instead of activating the focused action", async () => {
  const selected: string[] = [];
  const container = await openMenu(
    await renderMenu({ onSelect: (value) => selected.push(value) }),
  );
  await act(() =>
    items(container)[0]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(selected).toEqual([]);
  expect(
    requiredElement(container, "[data-trigger]").getAttribute("aria-expanded"),
  ).toBe("true");
});

it("keeps an initially empty menu keyboard reachable as items arrive", async () => {
  let load = () => {};
  function Loading(): FigNode {
    const [loaded, setLoaded] = useState(false);
    load = () => setLoaded(true);
    const menu = useMenu();
    return (
      <>
        <button data-trigger="" mix={menu.trigger()}>
          Actions
        </button>
        <div data-menu="" mix={menu.menu()}>
          {loaded ? <button mix={menu.item("copy")}>Copy</button> : "Loading"}
        </div>
      </>
    );
  }
  const host = await render(<Loading />);
  await keydown(requiredElement(host, "[data-trigger]"), "ArrowDown");
  const popup = requiredElement(host, "[data-menu]");
  expect(document.activeElement).toBe(popup);
  await act(load);
  expect(document.activeElement).toBe(popup);
  await keydown(popup, "ArrowDown");
  expect(document.activeElement).toBe(items(host)[0]);
});

it("ignores legacy IME confirmation without isComposing", async () => {
  const selected: string[] = [];
  const host = await openMenu(
    await renderMenu({ onSelect: (value) => selected.push(value) }),
  );
  await act(() =>
    items(host)[0]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(selected).toEqual([]);
});
