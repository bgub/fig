// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useToolbar } from "./toolbar.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Toolbar", () => {
  it("provides one tab stop and skips disabled items", async () => {
    const container = await render(<Example />);
    const root = required(container, '[role="toolbar"]');
    const [bold, italic, link] = items(container);

    expect(root.getAttribute("aria-orientation")).toBe("horizontal");
    expect(bold.tabIndex).toBe(0);
    expect(italic.tabIndex).toBe(-1);
    expect(italic.hasAttribute("disabled")).toBe(true);
    expect(link.tabIndex).toBe(-1);

    bold.focus();
    await keydown(bold, "ArrowRight");
    expect(document.activeElement).toBe(link);
    expect(link.tabIndex).toBe(0);

    await keydown(link, "Home");
    expect(document.activeElement).toBe(bold);
  });

  it("uses vertical arrows and can stop at the edge", async () => {
    const container = await render(
      <Example loopFocus={false} orientation="vertical" />,
    );
    const [bold, , link] = items(container);

    expect(
      required(container, '[role="toolbar"]').getAttribute("aria-orientation"),
    ).toBe("vertical");
    bold.focus();
    await keydown(bold, "ArrowRight");
    expect(document.activeElement).toBe(bold);
    await keydown(bold, "ArrowDown");
    expect(document.activeElement).toBe(link);
    await keydown(link, "ArrowDown");
    expect(document.activeElement).toBe(link);
  });

  it("follows right-to-left horizontal arrow direction", async () => {
    const container = await render(
      <div dir="rtl">
        <Example />
      </div>,
    );
    const [bold, , link] = items(container);

    bold.focus();
    await keydown(bold, "ArrowRight");
    expect(document.activeElement).toBe(link);
  });
});

function Example(props: {
  loopFocus?: boolean;
  orientation?: "horizontal" | "vertical";
}): FigNode {
  const toolbar = useToolbar<string>(props);
  return (
    <div aria-label="Formatting" mix={toolbar.root()}>
      <button mix={toolbar.item("bold")}>Bold</button>
      <button mix={toolbar.item("italic", { disabled: true })}>Italic</button>
      <button mix={toolbar.item("link")}>Link</button>
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

function items(container: Element): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-fig-toolbar-item]"),
  ];
}

async function keydown(element: HTMLElement, key: string): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    ),
  );
}
