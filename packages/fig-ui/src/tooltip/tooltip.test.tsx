// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { type TooltipOpenChangeHandler, useTooltip } from "./tooltip.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Tooltip", () => {
  it("describes its trigger and opens immediately for keyboard focus", async () => {
    const container = await render(<Example />);
    const trigger = required(container, "[data-trigger]");
    const tooltip = required(container, '[role="tooltip"]');

    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.hidden).toBe(true);

    await act(async () => {
      trigger.focus();
      await wait(1);
    });

    expect(tooltip.hidden).toBe(false);
    expect(trigger.hasAttribute("data-open")).toBe(true);
  });

  it("uses delayed pointer intent and closes on Escape", async () => {
    const changes: Array<{ event: string | null; open: boolean }> = [];
    const container = await render(
      <Example
        delay={20}
        onOpenChange={(open, details) =>
          changes.push({ event: details.event?.type ?? null, open })
        }
      />,
    );
    const trigger = required(container, "[data-trigger]");
    const tooltip = required(container, '[role="tooltip"]');

    await pointer(trigger, "pointerenter");
    await act(() => wait(10));
    expect(tooltip.hidden).toBe(true);
    await act(() => wait(15));
    expect(tooltip.hidden).toBe(false);

    await keydown(trigger, "Escape");
    expect(tooltip.hidden).toBe(true);
    expect(changes).toEqual([
      { event: "pointerenter", open: true },
      { event: "keydown", open: false },
    ]);
  });

  it("preserves authored descriptions and follows an authored tooltip id", async () => {
    const container = await render(<CustomIds />);
    const trigger = required(container, "[data-trigger]");

    expect(trigger.getAttribute("aria-describedby")?.split(/\s+/)).toEqual([
      "help",
      "authored-tooltip",
    ]);
  });
});

function Example(props: {
  delay?: number;
  onOpenChange?: TooltipOpenChangeHandler;
}): FigNode {
  const tooltip = useTooltip(props);
  return (
    <>
      <button data-trigger="" mix={tooltip.trigger()}>
        Save
      </button>
      <div mix={tooltip.tooltip()}>Saves the document</div>
    </>
  );
}

function CustomIds(): FigNode {
  const tooltip = useTooltip({ id: "authored-tooltip" });
  return (
    <>
      <span id="help">Keyboard shortcut available.</span>
      <button aria-describedby="help" data-trigger="" mix={tooltip.trigger()}>
        Save
      </button>
      <div mix={tooltip.tooltip()}>Saves the document</div>
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
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  await act(() => element.dispatchEvent(event));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
