// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  Popover,
  type PopoverOpenChangeHandler,
  type PopoverParts,
  usePopover,
} from "./popover.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Popover", () => {
  it("wires the trigger to the popover and publishes one anchor name", async () => {
    const container = await render(<Example />);
    const trigger = requiredElement(container, "[data-trigger]");
    const popover = requiredElement(container, "[data-popover]");

    expect(popover.getAttribute("popover")).toBe("auto");
    expect(trigger.getAttribute("aria-controls")).toBe(popover.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    // Placement is CSS anchor positioning, so the widget only names the pair.
    const anchorName = trigger.style.getPropertyValue("anchor-name");
    expect(anchorName.startsWith("--fig-popover-")).toBe(true);
    expect(trigger.style.getPropertyValue("anchor-name")).toBe(anchorName);
    expect(popover.style.getPropertyValue("position-anchor")).toBe(anchorName);
  });

  it("toggles without popover support and reports the change", async () => {
    const changes: Array<{ event: string | null; open: boolean }> = [];
    const container = await render(
      <Example
        onOpenChange={(open, details) =>
          changes.push({ event: details.event?.type ?? null, open })
        }
      />,
    );
    const trigger = requiredElement(container, "[data-trigger]");
    const popover = requiredElement(container, "[data-popover]");

    // happy-dom has no popover API, which is the fallback path: no top layer
    // and no light dismiss, but the markup still shows and hides.
    expect(popover.hidden).toBe(true);
    expect(trigger.getAttribute("popovertarget")).toBe(popover.id);

    await click(trigger);

    expect(popover.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(changes).toEqual([{ event: "click", open: true }]);

    await click(trigger);
    expect(popover.hidden).toBe(true);
  });

  it("follows a toggle the element reported", async () => {
    const changes: boolean[] = [];
    const container = await render(
      <Example onOpenChange={(open) => changes.push(open)} />,
    );
    const popover = requiredElement(container, "[data-popover]");
    const trigger = requiredElement(container, "[data-trigger]");

    await toggle(popover, "open");

    expect(changes).toEqual([true]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // A light dismissal arrives the same way.
    await toggle(popover, "closed");
    expect(changes).toEqual([true, false]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("lets a handler refuse a toggle the element proposed", async () => {
    const container = await render(
      <Example onOpenChange={(_open, details) => details.cancel()} />,
    );
    const popover = requiredElement(container, "[data-popover]");

    const event = await beforeToggle(popover, "open");

    expect(event.defaultPrevented).toBe(true);
    expect(
      requiredElement(container, "[data-trigger]").getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
  });

  it("opens and closes without an activation event", async () => {
    let parts: PopoverParts | undefined;
    const changes: Array<{ event: string | null; open: boolean }> = [];
    const container = await render(
      <Example
        onOpenChange={(open, details) =>
          changes.push({ event: details.event?.type ?? null, open })
        }
        onParts={(value) => {
          parts = value;
        }}
      />,
    );
    const popover = requiredElement(container, "[data-popover]");

    await act(() => parts?.setOpen(true));

    expect(popover.hidden).toBe(false);
    expect(changes).toEqual([{ event: null, open: true }]);
  });

  it("lets a controlled owner retry an ignored imperative change", async () => {
    let changes = 0;
    let parts: PopoverParts | undefined;
    function Controlled(): FigNode {
      const popover = usePopover({
        onOpenChange: () => (changes += 1),
        open: false,
      });
      parts = popover;
      return (
        <>
          <button mix={popover.trigger()}>Open</button>
          <div data-popover="" mix={popover.popover()} />
        </>
      );
    }
    const container = await render(<Controlled />);

    await act(() => parts?.setOpen(true));
    await act(() => parts?.setOpen(true));

    expect(changes).toBe(2);
    expect(requiredElement(container, "[data-popover]").hidden).toBe(true);
  });

  it("follows a caller-supplied id on the popover", async () => {
    const container = await render(
      <Popover id="custom-popover">
        {(popover) => (
          <div>
            <button data-trigger="" mix={popover.trigger()}>
              Open
            </button>
            <div data-popover="" mix={popover.popover()}>
              Content
            </div>
          </div>
        )}
      </Popover>,
    );

    expect(requiredElement(container, "[data-popover]").id).toBe(
      "custom-popover",
    );
    expect(
      requiredElement(container, "[data-trigger]").getAttribute(
        "aria-controls",
      ),
    ).toBe("custom-popover");
  });
});

function Example(props: {
  onOpenChange?: PopoverOpenChangeHandler;
  onParts?: (parts: PopoverParts) => void;
}): FigNode {
  const popover = usePopover({ onOpenChange: props.onOpenChange });
  props.onParts?.(popover);

  return (
    <div>
      <button data-trigger="" mix={popover.trigger()}>
        Open
      </button>
      <div data-popover="" mix={popover.popover()}>
        Content
      </div>
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

function requiredElement(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(() =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    ),
  );
}

function toggleEvent(type: string, newState: "open" | "closed"): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "newState", { value: newState });
  return event;
}

async function beforeToggle(
  popover: HTMLElement,
  newState: "open" | "closed",
): Promise<Event> {
  const event = toggleEvent("beforetoggle", newState);
  await act(() => popover.dispatchEvent(event));
  return event;
}

async function toggle(
  popover: HTMLElement,
  newState: "open" | "closed",
): Promise<void> {
  const event = toggleEvent("toggle", newState);
  await act(() => popover.dispatchEvent(event));
}
