// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useMenu } from "./menu.tsx";
import { useMenuSubmenu } from "./submenu.ts";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Menu submenu", () => {
  it("opens toward the inline end and returns focus toward the parent", async () => {
    const container = await render(<NestedMenu />);
    const rootTrigger = required(container, "[data-root-trigger]");
    rootTrigger.focus();
    await keydown(rootTrigger, "ArrowDown");
    const submenuTrigger = required(container, "[data-submenu-trigger]");
    expect(document.activeElement).toBe(submenuTrigger);

    await keydown(submenuTrigger, "ArrowRight");

    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("true");
    const childItem = required(container, "[data-child-item]");
    expect(document.activeElement).toBe(childItem);

    await keydown(childItem, "ArrowLeft");

    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(submenuTrigger);
    expect(rootTrigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the whole tree after a child action", async () => {
    const selected: string[] = [];
    const container = await render(
      <NestedMenu
        onSelect={(value) => {
          selected.push(value);
        }}
      />,
    );
    const rootTrigger = required(container, "[data-root-trigger]");
    rootTrigger.focus();
    await keydown(rootTrigger, "ArrowDown");
    await keydown(required(container, "[data-submenu-trigger]"), "ArrowRight");

    await keydown(required(container, "[data-child-item]"), "Enter");

    expect(selected).toEqual(["email"]);
    expect(rootTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes every ancestor in a deeper tree", async () => {
    const container = await render(<DeepMenu />);
    const rootTrigger = required(container, "[data-deep-root-trigger]");
    rootTrigger.focus();
    await keydown(rootTrigger, "ArrowDown");
    await keydown(required(container, "[data-middle-trigger]"), "ArrowRight");
    await keydown(required(container, "[data-leaf-trigger]"), "ArrowRight");

    await keydown(required(container, "[data-leaf-item]"), "Enter");

    expect(rootTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the tree when Tab leaves a child menu", async () => {
    const container = await render(<NestedMenu />);
    const rootTrigger = required(container, "[data-root-trigger]");
    rootTrigger.focus();
    await keydown(rootTrigger, "ArrowDown");
    await keydown(required(container, "[data-submenu-trigger]"), "ArrowRight");

    await keydown(required(container, "[data-child-item]"), "Tab");

    expect(rootTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("reverses open and close arrows in right-to-left menus", async () => {
    const container = await render(
      <div dir="rtl">
        <NestedMenu />
      </div>,
    );
    const rootTrigger = required(container, "[data-root-trigger]");
    rootTrigger.focus();
    await keydown(rootTrigger, "ArrowDown");
    const submenuTrigger = required(container, "[data-submenu-trigger]");

    await keydown(submenuTrigger, "ArrowLeft");
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("true");

    await keydown(required(container, "[data-child-item]"), "ArrowRight");
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not open a disabled submenu", async () => {
    const container = await render(<NestedMenu disabled={true} />);
    const rootTrigger = required(container, "[data-root-trigger]");
    rootTrigger.focus();
    await keydown(rootTrigger, "ArrowDown");
    const submenuTrigger = required(container, "[data-submenu-trigger]");

    await keydown(submenuTrigger, "ArrowRight");

    expect(submenuTrigger.getAttribute("aria-disabled")).toBe("true");
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("false");
  });
});

function NestedMenu(props: {
  disabled?: boolean;
  onSelect?: (value: string) => void;
}): FigNode {
  const menu = useMenu<string>();
  const share = useMenuSubmenu(menu, "share", {
    delay: 0,
    disabled: props.disabled,
    onSelect: props.onSelect,
  });
  return (
    <>
      <button data-root-trigger="" mix={menu.trigger()}>
        Actions
      </button>
      <div data-root-menu="" mix={menu.menu()}>
        <button data-submenu-trigger="" mix={share.trigger()}>
          Share
        </button>
        <div data-submenu="" mix={share.menu()}>
          <button data-child-item="" mix={share.item("email")}>
            Email
          </button>
        </div>
        <button mix={menu.item("rename")}>Rename</button>
      </div>
    </>
  );
}

function DeepMenu(): FigNode {
  const root = useMenu<string>();
  const middle = useMenuSubmenu(root, "middle", { delay: 0 });
  const leaf = useMenuSubmenu(middle, "leaf", { delay: 0 });
  return (
    <>
      <button data-deep-root-trigger="" mix={root.trigger()}>
        Root
      </button>
      <div mix={root.menu()}>
        <button data-middle-trigger="" mix={middle.trigger()}>
          Middle
        </button>
        <div mix={middle.menu()}>
          <button data-leaf-trigger="" mix={leaf.trigger()}>
            Leaf
          </button>
          <div mix={leaf.menu()}>
            <button data-leaf-item="" mix={leaf.item("action")}>
              Action
            </button>
          </div>
        </div>
      </div>
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

async function keydown(element: HTMLElement, key: string): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    ),
  );
}
