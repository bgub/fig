// @vitest-environment happy-dom
import { createMixin, type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useContextMenu, type ContextMenuOptions } from "./context-menu.tsx";
import { useMenuSubmenu } from "./submenu.ts";

const roots: FigRoot[] = [];
afterEach(async () => {
  while (roots.length) await act(() => roots.pop()!.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function Example(
  props: ContextMenuOptions<string> & {
    canceled?: boolean;
    dir?: "rtl" | "ltr";
  },
): FigNode {
  const menu = useContextMenu<string>(props);
  return (
    <div dir={props.dir} style={{ direction: props.dir }}>
      <div
        data-trigger=""
        mix={[
          on("contextmenu", (event) => {
            if (props.canceled) event.preventDefault();
          }),
          menu.trigger(),
        ]}
      >
        File
      </div>
      <div data-popup="" mix={menu.menu()}>
        <button mix={menu.item("edit")}>Edit</button>
        <button mix={menu.item("remove")}>Remove</button>
      </div>
    </div>
  );
}

async function render(node: FigNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}
function get(container: Element, selector: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
async function context(trigger: HTMLElement, x = 100, y = 120) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: x,
    clientY: y,
  });
  await act(() => trigger.dispatchEvent(event));
  return event;
}
async function key(trigger: HTMLElement, name: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    shiftKey,
  });
  await act(() => trigger.dispatchEvent(event));
  return event;
}

it("opens on right click at the pointer, reports the event, and returns focus", async () => {
  const changes: string[] = [];
  const host = await render(
    <Example
      onOpenChange={(_, details) => changes.push(details.event?.type ?? "none")}
    />,
  );
  const trigger = get(host, "[data-trigger]");
  const popup = get(host, "[data-popup]");
  expect(trigger.tabIndex).toBe(0);
  expect((await context(trigger)).defaultPrevented).toBe(true);
  expect(changes).toEqual(["contextmenu"]);
  expect(popup.style.left).toBe("100px");
  expect(popup.style.top).toBe("120px");
  expect(document.activeElement?.textContent).toBe("Edit");
  await key(get(host, "button"), "Enter");
  expect(popup.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
  expect(popup.style.position).toBe("");
});

it.each(["ContextMenu", "F10"])(
  "opens with %s at the target's bottom edge",
  async (name) => {
    const host = await render(<Example />);
    const trigger = get(host, "[data-trigger]");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
      new DOMRect(40, 50, 100, 30),
    );
    expect((await key(trigger, name, name === "F10")).defaultPrevented).toBe(
      true,
    );
    expect(get(host, "[data-popup]").style.top).toBe("80px");
    expect(document.activeElement?.textContent).toBe("Edit");
  },
);

it("does not open for primary clicks or plain F10", async () => {
  const host = await render(<Example />);
  const trigger = get(host, "[data-trigger]");
  await act(() => trigger.click());
  await key(trigger, "F10");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it.each(["disabled", "canceled"] as const)(
  "honors %s context invocation",
  async (flag) => {
    const host = await render(<Example {...{ [flag]: true }} />);
    const trigger = get(host, "[data-trigger]");
    await context(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("honors canceled change requests and can retry later", async () => {
  let cancel = true;
  const host = await render(
    <Example
      onOpenChange={(_, details) => {
        if (cancel) details.cancel();
      }}
    />,
  );
  const trigger = get(host, "[data-trigger]");
  await context(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  cancel = false;
  await context(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("repositions an already open menu and clamps it to viewport edges", async () => {
  const host = await render(<Example />);
  const trigger = get(host, "[data-trigger]");
  const popup = get(host, "[data-popup]");
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 150),
  );
  await context(trigger, 20, 30);
  expect(popup.style.left).toBe("20px");
  await context(trigger, window.innerWidth - 2, window.innerHeight - 2);
  expect(popup.style.left).toBe(`${window.innerWidth - 208}px`);
  expect(popup.style.top).toBe(`${window.innerHeight - 158}px`);
});

it("uses the inline-start side in RTL", async () => {
  const host = await render(<Example dir="rtl" />);
  const popup = get(host, "[data-popup]");
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 50),
  );
  await context(get(host, "[data-trigger]"), 400, 100);
  expect(popup.style.left).toBe("300px");
});

it("supports submenu focus and closes the whole tree on selection", async () => {
  function Nested(): FigNode {
    const parent = useContextMenu();
    const child = useMenuSubmenu(parent, "more");
    return (
      <>
        <div data-trigger="" mix={parent.trigger()}>
          File
        </div>
        <div mix={parent.menu()}>
          <button data-child="" mix={child.trigger()}>
            More
          </button>
          <div mix={child.menu()}>
            <button data-item="" mix={child.item("copy")}>
              Copy
            </button>
          </div>
        </div>
      </>
    );
  }
  const host = await render(<Nested />);
  const trigger = get(host, "[data-trigger]");
  await context(trigger);
  await key(get(host, "[data-child]"), "ArrowRight");
  expect(document.activeElement).toBe(get(host, "[data-item]"));
  await key(get(host, "[data-item]"), "Enter");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("keeps focus return valid after the same trigger rebinds", async () => {
  let update = () => {};
  function Rebound(): FigNode {
    const [name, setName] = useState("First");
    update = () => setName("Second");
    const menu = useContextMenu();
    return (
      <>
        <div data-trigger="" mix={menu.trigger()}>
          {name}
        </div>
        <div mix={menu.menu()}>
          <button mix={menu.item("edit")}>Edit</button>
        </div>
      </>
    );
  }
  const host = await render(<Rebound />);
  const trigger = get(host, "[data-trigger]");
  await context(trigger);
  await act(update);
  await key(get(host, "button"), "Enter");
  expect(document.activeElement).toBe(trigger);
});

it("positions a replacement popup while already open", async () => {
  let replace = () => {};
  function Replace(): FigNode {
    const [version, setVersion] = useState(0);
    replace = () => setVersion(version + 1);
    const menu = useContextMenu();
    return (
      <>
        <div data-trigger="" mix={menu.trigger()}>
          File
        </div>
        <div key={version} data-popup="" mix={menu.menu()}>
          <button mix={menu.item("edit")}>Edit</button>
        </div>
      </>
    );
  }
  const host = await render(<Replace />);
  await context(get(host, "[data-trigger]"), 120, 130);
  await act(replace);
  expect(get(host, "[data-popup]").style.left).toBe("120px");
});

it("keeps observation stable on rerender and removes listeners on close", async () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  const constructed = vi.fn();
  const OriginalObserver = globalThis.ResizeObserver;
  class Observer {
    constructor() {
      constructed();
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", Observer);
  let update = () => {};
  function Rerender(): FigNode {
    const [count, setCount] = useState(0);
    update = () => setCount(count + 1);
    const menu = useContextMenu();
    return (
      <>
        <div data-trigger="" mix={menu.trigger()}>
          File {count}
        </div>
        <div data-popup="" mix={menu.menu()}>
          <button mix={menu.item("edit")}>Edit</button>
        </div>
      </>
    );
  }
  try {
    const host = await render(<Rerender />);
    expect(constructed).not.toHaveBeenCalled();
    await context(get(host, "[data-trigger]"));
    await act(update);
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(2);
    await key(get(host, "button"), "Enter");
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    vi.stubGlobal("ResizeObserver", OriginalObserver);
  }
});

it("reclamps on resize and follows keyboard targets when scrolling", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const host = await render(<Example />);
  const trigger = get(host, "[data-trigger]");
  const rect = vi
    .spyOn(trigger, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(100, 200, 40, 20));
  await key(trigger, "ContextMenu");
  expect(get(host, "[data-popup]").style.top).toBe("220px");
  rect.mockReturnValue(new DOMRect(100, 300, 40, 20));
  window.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("resize"));
  expect(frames).toHaveLength(1);
  await act(() => frames[0]!(0));
  expect(get(host, "[data-popup]").style.top).toBe("320px");
  expect(get(host, "[data-popup]").style.maxHeight).toBe(
    `${window.innerHeight - 16}px`,
  );
});

it("leaves keyboard invocation canceled by an earlier handler alone", async () => {
  function Canceled(): FigNode {
    const menu = useContextMenu();
    return (
      <>
        <div
          data-trigger=""
          mix={[
            on("keydown", (event) => event.preventDefault()),
            menu.trigger(),
          ]}
        >
          File
        </div>
        <div mix={menu.menu()}>
          <button mix={menu.item("edit")}>Edit</button>
        </div>
      </>
    );
  }
  const host = await render(<Canceled />);
  const trigger = get(host, "[data-trigger]");
  await key(trigger, "ContextMenu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("respects a CSS direction override inside an RTL ancestor", async () => {
  function Direction(): FigNode {
    const menu = useContextMenu();
    return (
      <div dir="rtl">
        <div data-trigger="" style={{ direction: "ltr" }} mix={menu.trigger()}>
          File
        </div>
        <div data-popup="" mix={menu.menu()}>
          <button mix={menu.item("edit")}>Edit</button>
        </div>
      </div>
    );
  }
  const host = await render(<Direction />);
  const popup = get(host, "[data-popup]");
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 50),
  );
  await context(get(host, "[data-trigger]"), 400, 100);
  expect(popup.style.left).toBe("400px");
});

it("uses popup CSS coordinates when the context region is zoomed", async () => {
  const host = await render(<Example />);
  const popup = get(host, "[data-popup]");
  Object.defineProperty(popup, "currentCSSZoom", {
    value: 2,
    configurable: true,
  });
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 100),
  );
  await context(get(host, "[data-trigger]"), 400, 200);
  expect(popup.style.left).toBe("200px");
  expect(popup.style.top).toBe("100px");
  expect(popup.style.maxHeight).toBe(`${(window.innerHeight - 16) / 2}px`);
});

it("honors new authored size constraints while open and preserves them on close", async () => {
  let change = () => {};
  function Styled(): FigNode {
    const [height, setHeight] = useState("100px");
    change = () => setHeight("200px");
    const menu = useContextMenu();
    return (
      <>
        <div data-trigger="" mix={menu.trigger()}>
          File
        </div>
        <div data-popup="" style={{ maxHeight: height }} mix={menu.menu()}>
          <button mix={menu.item("edit")}>Edit</button>
        </div>
      </>
    );
  }
  const host = await render(<Styled />);
  const popup = get(host, "[data-popup]");
  await context(get(host, "[data-trigger]"));
  expect(popup.style.maxHeight).toContain("100px");
  await act(change);
  expect(popup.style.maxHeight).toContain("200px");
  await key(get(host, "button"), "Enter");
  expect(popup.style.maxHeight).toBe("200px");
});

it("multiplies ancestor zoom when currentCSSZoom is unavailable", async () => {
  const host = await render(
    <div style={{ zoom: "200%" }}>
      <Example />
    </div>,
  );
  const popup = get(host, "[data-popup]");
  Object.defineProperty(popup, "currentCSSZoom", {
    value: undefined,
    configurable: true,
  });
  popup.style.setProperty("zoom", "1.5");
  await context(get(host, "[data-trigger]"), 300, 180);
  expect(popup.style.left).toBe("100px");
  expect(popup.style.top).toBe("60px");
});

it("focuses the first item when mounted initially open", async () => {
  const host = await render(<Example defaultOpen />);
  expect(get(host, "[data-popup]").style.position).toBe("fixed");
  expect(document.activeElement).toBe(get(host, "button"));
});

it("retries controlled refusals without moving focus into a closed menu", async () => {
  const requests: string[] = [];
  const host = await render(
    <Example
      open={false}
      onOpenChange={(_, details) =>
        requests.push(details.event?.type ?? "none")
      }
    />,
  );
  const trigger = get(host, "[data-trigger]");
  trigger.focus();
  await context(trigger);
  await key(trigger, "ContextMenu");
  expect(requests).toEqual(["contextmenu", "keydown"]);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
  expect(get(host, "[data-popup]").style.position).toBe("");
});

it("provides the context area as native source without adding a CSS anchor", async () => {
  const host = await render(<Example />);
  const popup = get(host, "[data-popup]");
  const trigger = get(host, "[data-trigger]");
  const show = vi.fn();
  Object.assign(popup, {
    showPopover: show,
    hidePopover: vi.fn(),
    matches: () => false,
  });
  await context(trigger);
  expect(show.mock.calls.at(-1)).toEqual([{ source: trigger }]);
  expect(trigger.style.getPropertyValue("anchor-name")).toBe("");
  expect(popup.style.position).toBe("fixed");
});

it("honors disabled authored by a later mixin", async () => {
  const disable = createMixin(() => ({ disabled: true }));
  function LateDisabled(): FigNode {
    const menu = useContextMenu();
    return (
      <>
        <button data-trigger="" mix={[menu.trigger(), disable()]}>
          File
        </button>
        <div mix={menu.menu()}>
          <button mix={menu.item("copy")}>Copy</button>
        </div>
      </>
    );
  }
  const host = await render(<LateDisabled />);
  const trigger = get(host, "[data-trigger]");
  await context(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("checks the live native disabled state before keyboard context opening", async () => {
  const host = await render(<Example />);
  const trigger = get(host, "[data-trigger]");
  const matches = vi
    .spyOn(trigger, "matches")
    .mockImplementation((selector) => selector === ":disabled");
  await key(trigger, "ContextMenu");
  expect(matches).toHaveBeenCalledWith(":disabled");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
