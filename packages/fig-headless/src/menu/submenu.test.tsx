// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
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
  it("keeps a submenu closed while keyboard focus moves through its trigger", async () => {
    const container = await render(<NestedMenu />);
    await keydown(required(container, "[data-root-trigger]"), "ArrowDown");
    const trigger = required(container, "[data-submenu-trigger]");
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await keydown(trigger, "ArrowDown");
    await keydown(required(container, "[data-rename]"), "ArrowUp");
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles a submenu with Enter after explicit activation", async () => {
    const key = "Enter";
    const container = await render(<NestedMenu />);
    await keydown(required(container, "[data-root-trigger]"), "ArrowDown");
    const trigger = required(container, "[data-submenu-trigger]");
    await keydown(trigger, key);
    expect(document.activeElement).toBe(
      required(container, "[data-child-item]"),
    );
    await act(() => trigger.focus());
    await keydown(trigger, key);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it.each(["touch", "", "mouse"])(
    "handles repeated %s clicks",
    async (pointerType) => {
      const container = await render(<NestedMenu />);
      await keydown(required(container, "[data-root-trigger]"), "ArrowDown");
      const trigger = required(container, "[data-submenu-trigger]");
      const click = () =>
        act(() => {
          trigger.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, pointerType }),
          );
          trigger.dispatchEvent(
            new PointerEvent("click", {
              bubbles: true,
              cancelable: true,
              pointerType,
              detail: pointerType === "" ? 0 : 1,
            }),
          );
        });
      await click();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await act(() => trigger.focus());
      await click();
      expect(trigger.getAttribute("aria-expanded")).toBe(
        String(pointerType === "mouse"),
      );
    },
  );

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
    expect(document.activeElement).toBe(rootTrigger);
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
    expect(document.activeElement).toBe(rootTrigger);
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
      <div dir="rtl" style={{ direction: "rtl" }}>
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

  it("keeps typeahead inside the active submenu", async () => {
    const container = await render(<NestedMenu />);
    const rootTrigger = required(container, "[data-root-trigger]");
    await keydown(rootTrigger, "ArrowDown");
    await keydown(required(container, "[data-submenu-trigger]"), "ArrowRight");
    const child = required(container, "[data-child-item]");

    await keydown(child, "r");

    expect(document.activeElement).toBe(child);
  });

  it("closes only the innermost submenu with the return arrow", async () => {
    const container = await render(<DeepMenu />);
    await keydown(required(container, "[data-deep-root-trigger]"), "ArrowDown");
    const middle = required(container, "[data-middle-trigger]");
    const leaf = required(container, "[data-leaf-trigger]");
    await keydown(middle, "ArrowRight");
    await keydown(leaf, "ArrowRight");

    await keydown(required(container, "[data-leaf-item]"), "ArrowLeft");

    expect(leaf.getAttribute("aria-expanded")).toBe("false");
    expect(middle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(leaf);
  });

  it("still opens on hover while the parent stays open", async () => {
    const container = await render(<NestedMenu delay={20} />);
    await keydown(required(container, "[data-root-trigger]"), "ArrowUp");
    const trigger = required(container, "[data-submenu-trigger]");
    await act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerenter", {
          pointerType: "mouse",
        }),
      ),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(required(container, "[data-rename]"));
  });

  it("does not reopen a submenu after its parent closes during the hover delay", async () => {
    const container = await render(<NestedMenu delay={20} />);
    const rootTrigger = required(container, "[data-root-trigger]");
    await keydown(rootTrigger, "ArrowUp");
    const trigger = required(container, "[data-submenu-trigger]");
    await act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerenter", {
          pointerType: "mouse",
        }),
      ),
    );
    await keydown(trigger, "Tab");
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));

    expect(rootTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["ArrowRight", "Enter"])(
    "moves focus into an already hover-open submenu with %s",
    async (key) => {
      const container = await render(<NestedMenu delay={10} />);
      await keydown(required(container, "[data-root-trigger]"), "ArrowUp");
      const trigger = required(container, "[data-submenu-trigger]");
      await pointer(trigger, "pointerenter");
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(required(container, "[data-rename]"));
      await keydown(trigger, key);
      expect(document.activeElement).toBe(
        required(container, "[data-child-item]"),
      );
    },
  );

  it("cancels a pending pointer close when keyboard navigation takes over", async () => {
    const container = await render(<NestedMenu delay={20} />);
    await keydown(required(container, "[data-root-trigger]"), "ArrowDown");
    const trigger = required(container, "[data-submenu-trigger]");
    await keydown(trigger, "ArrowRight");
    const child = required(container, "[data-child-item]");
    await pointer(required(container, "[data-submenu]"), "pointerleave");
    await keydown(child, "ArrowDown");
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(child);
  });

  it.each(["ArrowRight", "Enter"])(
    "does not open a disabled submenu with %s",
    async (key) => {
      const container = await render(<NestedMenu disabled={true} />);
      const rootTrigger = required(container, "[data-root-trigger]");
      rootTrigger.focus();
      await keydown(rootTrigger, "ArrowDown");
      const submenuTrigger = required(container, "[data-submenu-trigger]");

      await keydown(submenuTrigger, key);

      expect(submenuTrigger.getAttribute("aria-disabled")).toBe("true");
      expect(submenuTrigger.getAttribute("aria-expanded")).toBe("false");
    },
  );
});

function NestedMenu(props: {
  delay?: number;
  disabled?: boolean;
  onSelect?: (value: string) => void;
}): FigNode {
  const menu = useMenu<string>();
  const share = useMenuSubmenu(menu, "share", {
    delay: props.delay ?? 0,
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
        <button data-rename="" mix={menu.item("rename")}>
          Rename
        </button>
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

async function pointer(element: HTMLElement, type: string): Promise<void> {
  await act(() =>
    element.dispatchEvent(new PointerEvent(type, { pointerType: "mouse" })),
  );
}

it("returns to the root trigger when a sibling-mounted submenu action closes the tree", async () => {
  function Siblings(): FigNode {
    const parent = useMenu();
    const child = useMenuSubmenu(parent, "more");
    return (
      <>
        <button data-root-trigger="" mix={parent.trigger()}>
          Actions
        </button>
        <div mix={parent.menu()}>
          <button data-submenu-trigger="" mix={child.trigger()}>
            More
          </button>
        </div>
        <div mix={child.menu()}>
          <button data-child-item="" mix={child.item("copy")}>
            Copy
          </button>
        </div>
      </>
    );
  }
  const host = await render(<Siblings />);
  const trigger = required(host, "[data-root-trigger]");
  await keydown(trigger, "ArrowDown");
  await keydown(required(host, "[data-submenu-trigger]"), "ArrowRight");
  await keydown(required(host, "[data-child-item]"), "Enter");
  expect(document.activeElement).toBe(trigger);
});

it.each(["Enter", "ArrowRight"])(
  "honors an authored disabled submenu trigger for %s",
  async (key) => {
    function NativeDisabled(): FigNode {
      const parent = useMenu();
      const child = useMenuSubmenu(parent, "more");
      return (
        <>
          <button data-root-trigger="" mix={parent.trigger()}>
            Actions
          </button>
          <div mix={parent.menu()}>
            <button disabled data-submenu-trigger="" mix={child.trigger()}>
              More
            </button>
            <div mix={child.menu()}>
              <button mix={child.item("copy")}>Copy</button>
            </div>
          </div>
        </>
      );
    }
    const host = await render(<NativeDisabled />);
    await keydown(required(host, "[data-root-trigger]"), "ArrowDown");
    const trigger = required(host, "[data-submenu-trigger]");
    await keydown(trigger, key);
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("uses the computed direction inside an ancestor with an opposite dir", async () => {
  const host = await render(
    <div dir="rtl">
      <div style={{ direction: "ltr" }}>
        <NestedMenu />
      </div>
    </div>,
  );
  await keydown(required(host, "[data-root-trigger]"), "ArrowDown");
  const trigger = required(host, "[data-submenu-trigger]");
  await keydown(trigger, "ArrowRight");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("cancels pending hover when the authored trigger becomes disabled", async () => {
  let disable = () => {};
  function Disable(): FigNode {
    const [disabled, setDisabled] = useState(false);
    disable = () => setDisabled(true);
    const parent = useMenu();
    const child = useMenuSubmenu(parent, "more", { delay: 20 });
    return (
      <>
        <button data-root-trigger="" mix={parent.trigger()}>
          Actions
        </button>
        <div mix={parent.menu()}>
          <button mix={parent.item("other")}>Other</button>
          <button
            disabled={disabled}
            data-submenu-trigger=""
            mix={child.trigger()}
          >
            More
          </button>
          <div mix={child.menu()}>
            <button mix={child.item("copy")}>Copy</button>
          </div>
        </div>
      </>
    );
  }
  const host = await render(<Disable />);
  await keydown(required(host, "[data-root-trigger]"), "ArrowDown");
  const trigger = required(host, "[data-submenu-trigger]");
  await pointer(trigger, "pointerenter");
  await act(disable);
  await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("does not steal caller-directed focus when a sibling submenu closes", async () => {
  function Redirect(): FigNode {
    const parent = useMenu();
    const child = useMenuSubmenu(parent, "more", {
      onSelect: () =>
        document.querySelector<HTMLButtonElement>("[data-outside]")?.focus(),
    });
    return (
      <>
        <button data-outside="">Outside</button>
        <button data-root-trigger="" mix={parent.trigger()}>
          Actions
        </button>
        <div mix={parent.menu()}>
          <button data-submenu-trigger="" mix={child.trigger()}>
            More
          </button>
        </div>
        <div mix={child.menu()}>
          <button data-child-item="" mix={child.item("copy")}>
            Copy
          </button>
        </div>
      </>
    );
  }
  const host = await render(<Redirect />);
  await keydown(required(host, "[data-root-trigger]"), "ArrowDown");
  await keydown(required(host, "[data-submenu-trigger]"), "ArrowRight");
  await keydown(required(host, "[data-child-item]"), "Enter");
  expect(document.activeElement).toBe(required(host, "[data-outside]"));
});

it.each(["ArrowRight", "Enter"])(
  "does not open a submenu during IME %s",
  async (key) => {
    const host = await render(<NestedMenu />);
    await keydown(required(host, "[data-root-trigger]"), "ArrowDown");
    const trigger = required(host, "[data-submenu-trigger]");
    await keydown(trigger, "ArrowRight");
    await keydown(required(host, "[data-child-item]"), "ArrowLeft");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("keeps pending hover across same-host renders but cancels it on replacement", async () => {
  let update = (_replace: boolean) => {};
  function Replace(): FigNode {
    const [version, setVersion] = useState(0);
    const [replacement, setReplacement] = useState(false);
    update = (replace) => {
      setVersion((v) => v + 1);
      setReplacement(replace);
    };
    const parent = useMenu();
    const child = useMenuSubmenu(parent, "more", { delay: 20 });
    return (
      <>
        <button data-root-trigger="" mix={parent.trigger()}>
          Root
        </button>
        <div mix={parent.menu()}>
          <button
            data-submenu-trigger=""
            key={String(replacement)}
            data-version={version}
            mix={child.trigger()}
          >
            More
          </button>
          <div mix={child.menu()}>
            <button mix={child.item("copy")}>Copy</button>
          </div>
        </div>
      </>
    );
  }
  const host = await render(<Replace />);
  await keydown(required(host, "[data-root-trigger]"), "ArrowDown");
  let trigger = required(host, "[data-submenu-trigger]");
  await pointer(trigger, "pointerenter");
  await act(() => update(false));
  await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await keydown(trigger, "Enter");
  await keydown(
    required(host, '[role="menuitem"]:not([data-submenu-trigger])'),
    "ArrowLeft",
  );
  await pointer(trigger, "pointerenter");
  await act(() => update(true));
  trigger = required(host, "[data-submenu-trigger]");
  await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
