// @vitest-environment happy-dom
import { type FigNode, useBeforePaint } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useCombobox } from "../combobox/combobox.tsx";
import { useDialog } from "../dialog/dialog.tsx";
import { useMenu } from "../menu/menu.tsx";
import { useMenuSubmenu } from "../menu/submenu.ts";
import { usePopover } from "../popover/popover.tsx";
import { useSelect } from "../select/select.tsx";
import { useTooltip } from "../tooltip/tooltip.tsx";
const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
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
function get(container: Element, selector: string) {
  const node = container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(selector);
  return node;
}
async function key(node: HTMLElement, key: string) {
  await act(() =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

it.each(["Enter", "ArrowDown", "ArrowUp"])(
  "honors a canceled menu trigger %s",
  async (keyName) => {
    function Example(): FigNode {
      const menu = useMenu();
      return (
        <>
          <button
            mix={[
              on("keydown", (event) => event.preventDefault()),
              menu.trigger(),
            ]}
          >
            Actions
          </button>
          <div mix={menu.menu()}>
            <button mix={menu.item("a")}>Action</button>
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    const trigger = get(container, "button");
    await key(trigger, keyName);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it.each(["ArrowRight", "Tab"])(
  "honors canceled submenu %s",
  async (keyName) => {
    function Example(): FigNode {
      const parent = useMenu({ defaultOpen: true });
      const child = useMenuSubmenu(parent, "child", {
        defaultOpen: keyName === "Tab",
      });
      return (
        <>
          <button data-parent="" mix={parent.trigger()}>
            Actions
          </button>
          <div mix={parent.menu()}>
            <button mix={parent.item("other")}>Other</button>
            <button
              data-child=""
              mix={[
                on("keydown", (event) => event.preventDefault()),
                child.trigger(),
              ]}
            >
              More
            </button>
            <div mix={child.menu()}>
              <button
                data-item=""
                mix={[
                  on("keydown", (event) => event.preventDefault()),
                  child.item("a"),
                ]}
              >
                Action
              </button>
            </div>
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    await key(
      get(container, keyName === "Tab" ? "[data-item]" : "[data-child]"),
      keyName,
    );
    expect(get(container, "[data-parent]").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(get(container, "[data-child]").getAttribute("aria-expanded")).toBe(
      keyName === "Tab" ? "true" : "false",
    );
  },
);

it.each(["popover", "combobox", "tooltip"])(
  "does not adopt a canceled native %s opening",
  async (kind) => {
    function Example(): FigNode {
      const popover = usePopover(),
        combo = useCombobox(),
        tooltip = useTooltip();
      const cancel = on("beforetoggle", (event) => event.preventDefault());
      if (kind === "combobox")
        return (
          <>
            <input aria-label="Search" mix={combo.input()} />
            <div data-popup="" mix={[cancel, combo.popup()]} />
          </>
        );
      if (kind === "tooltip")
        return (
          <>
            <button mix={tooltip.trigger()}>Help</button>
            <div data-popup="" mix={[cancel, tooltip.tooltip()]}>
              Hint
            </div>
          </>
        );
      return (
        <>
          <button mix={popover.trigger()}>Open</button>
          <div data-popup="" mix={[cancel, popover.popover()]}>
            Contents
          </div>
        </>
      );
    }
    const container = await render(<Example />);
    const popup = get(container, "[data-popup]");
    const event = new Event("beforetoggle", { cancelable: true });
    Object.defineProperty(event, "newState", { value: "open" });
    await act(() => popup.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(popup.hasAttribute("data-open")).toBe(false);
    expect(popup.hidden).toBe(true);
  },
);

it("does not close a dialog after its native cancel event is prevented", async () => {
  function Example(): FigNode {
    const dialog = useDialog({ defaultOpen: true });
    return (
      <dialog
        aria-label="Settings"
        mix={[on("cancel", (event) => event.preventDefault()), dialog.dialog()]}
      />
    );
  }
  const container = await render(<Example />);
  const dialog = get(container, "dialog") as HTMLDialogElement;
  await act(() =>
    dialog.dispatchEvent(new Event("cancel", { cancelable: true })),
  );
  expect(dialog.open).toBe(true);
  expect(dialog.hasAttribute("data-open")).toBe(true);
});

it.each(["select", "combobox"])(
  "cancels deferred %s scrolling when another layout hook closes it",
  async (kind) => {
    const reveal = vi.fn();
    function SelectExample() {
      const select = useSelect();
      useBeforePaint(() => {
        if (select.open) select.setOpen(false);
      });
      return (
        <>
          <button data-input="" mix={select.trigger()}>
            Choose
          </button>
          <div mix={select.popup()}>
            <div
              bind={(node) => {
                node.scrollIntoView = reveal;
              }}
              mix={select.option("a")}
            >
              Apple
            </div>
          </div>
        </>
      );
    }
    function ComboboxExample() {
      const combobox = useCombobox();
      useBeforePaint(() => {
        if (combobox.open) combobox.setOpen(false);
      });
      return (
        <>
          <input data-input="" aria-label="Choose" mix={combobox.input()} />
          <div mix={combobox.popup()}>
            <div
              bind={(node) => {
                node.scrollIntoView = reveal;
              }}
              mix={combobox.option("a")}
            >
              Apple
            </div>
          </div>
        </>
      );
    }
    const container = await render(
      kind === "select" ? <SelectExample /> : <ComboboxExample />,
    );
    await key(get(container, "[data-input]"), "ArrowDown");
    expect(get(container, "[data-input]").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(reveal).not.toHaveBeenCalled();
  },
);
