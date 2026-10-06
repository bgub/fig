// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
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

  it("honors an earlier handler canceling Escape", async () => {
    function CanceledTooltip(): FigNode {
      const tooltip = useTooltip({ defaultOpen: true });
      return (
        <>
          <button
            mix={[
              on("keydown", (event) => event.preventDefault()),
              tooltip.trigger(),
            ]}
          >
            Help
          </button>
          <div mix={tooltip.tooltip()}>Hint</div>
        </>
      );
    }
    const container = await render(<CanceledTooltip />);
    await keydown(required(container, "button"), "Escape");
    expect(required(container, '[role="tooltip"]').hidden).toBe(false);
  });

  it("keeps a focused tooltip open when the pointer leaves", async () => {
    const container = await render(<Example delay={0} />);
    const trigger = required(container, "[data-trigger]");
    const tooltip = required(container, '[role="tooltip"]');
    await act(async () => {
      trigger.focus();
      await wait(1);
    });
    await pointer(trigger, "pointerenter");
    await pointer(trigger, "pointerleave");
    await act(() => wait(1));
    expect(document.activeElement).toBe(trigger);
    expect(tooltip.hidden).toBe(false);
  });

  it("does not cancel a pending focus open when the pointer leaves immediately", async () => {
    const container = await render(<Example delay={20} />);
    const trigger = required(container, "[data-trigger]");
    await act(() => {
      trigger.focus();
      trigger.dispatchEvent(
        new PointerEvent("pointerleave", { pointerType: "mouse" }),
      );
    });
    await act(() => wait(1));
    expect(required(container, '[role="tooltip"]').hidden).toBe(false);
  });

  it("cancels a pending hover open when disabled", async () => {
    let disable = () => {};
    function DisabledDuringHover(): FigNode {
      const [disabled, setDisabled] = useState(false);
      disable = () => setDisabled(true);
      return <Example delay={20} disabled={disabled} />;
    }
    const container = await render(<DisabledDuringHover />);
    await pointer(required(container, "[data-trigger]"), "pointerenter");
    await act(disable);
    await act(() => wait(30));
    expect(required(container, '[role="tooltip"]').hidden).toBe(true);
  });

  it.each([false, true])(
    "cancels pending hover when its trigger is removed or replaced (%s)",
    async (replace) => {
      let changeTrigger = () => {};
      const changes: boolean[] = [];
      function ChangingTrigger(): FigNode {
        const [changed, setChanged] = useState(false);
        changeTrigger = () => setChanged(true);
        const tooltip = useTooltip({
          delay: 20,
          onOpenChange: (open) => changes.push(open),
        });
        return (
          <>
            {!changed ? (
              <button key="old" mix={tooltip.trigger()}>
                Old trigger
              </button>
            ) : replace ? (
              <button key="new" mix={tooltip.trigger()}>
                New trigger
              </button>
            ) : null}
            <div mix={tooltip.tooltip()}>Hint</div>
          </>
        );
      }
      const container = await render(<ChangingTrigger />);
      await pointer(required(container, "button"), "pointerenter");
      await act(changeTrigger);
      await act(() => wait(30));
      expect(required(container, '[role="tooltip"]').hidden).toBe(true);
      expect(changes).toEqual([]);
      if (replace) {
        await pointer(required(container, "button"), "pointerenter");
        await act(() => wait(30));
        expect(required(container, '[role="tooltip"]').hidden).toBe(false);
      }
    },
  );

  it.each([false, true])(
    "finishes a pending close when its trigger is removed or replaced (%s)",
    async (replace) => {
      let changeTrigger = () => {};
      function ChangingTrigger(): FigNode {
        const [changed, setChanged] = useState(false);
        changeTrigger = () => setChanged(true);
        const tooltip = useTooltip({ defaultOpen: true, closeDelay: 20 });
        return (
          <>
            {!changed ? (
              <button key="old" mix={tooltip.trigger()}>
                Old trigger
              </button>
            ) : replace ? (
              <button key="new" mix={tooltip.trigger()}>
                New trigger
              </button>
            ) : null}
            <div mix={tooltip.tooltip()}>Hint</div>
          </>
        );
      }
      const container = await render(<ChangingTrigger />);
      await pointer(required(container, "button"), "pointerleave");
      await act(changeTrigger);
      await act(() => wait(30));
      expect(required(container, '[role="tooltip"]').hidden).toBe(true);
    },
  );

  it("preserves a pending hover across a render of the same trigger", async () => {
    let rerender = () => {};
    function SameTrigger(): FigNode {
      const [count, setCount] = useState(0);
      rerender = () => setCount(count + 1);
      const tooltip = useTooltip({ delay: 20 });
      return (
        <>
          <button mix={tooltip.trigger()}>Trigger {count}</button>
          <div mix={tooltip.tooltip()}>Hint</div>
        </>
      );
    }
    const container = await render(<SameTrigger />);
    await pointer(required(container, "button"), "pointerenter");
    await act(rerender);
    await act(() => wait(30));
    expect(required(container, '[role="tooltip"]').hidden).toBe(false);
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
  disabled?: boolean;
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
