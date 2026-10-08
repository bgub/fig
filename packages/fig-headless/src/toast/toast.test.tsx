// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { type ToastDismissHandler, useToastRegion } from "./toast.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("ToastRegion", () => {
  it("provides a named, persistent live region", async () => {
    const container = await render(
      <Example duration={null} priority="assertive" />,
    );
    const region = required(container, '[role="region"]');
    const toast = required(container, "[data-toast]");
    const dismiss = required(container, "button");

    expect(region.getAttribute("aria-label")).toBe("Notifications");
    expect(region.getAttribute("aria-live")).toBe("assertive");
    expect(region.getAttribute("aria-atomic")).toBe("false");
    expect(region.getAttribute("aria-relevant")).toBe("additions text");
    expect(toast.getAttribute("aria-atomic")).toBe("true");
    expect(dismiss.getAttribute("type")).toBe("button");
  });

  it("reports explicit dismissals with their originating event", async () => {
    const calls: Array<{
      event: string | null;
      reason: string;
      value: string;
    }> = [];
    const container = await render(
      <Example
        duration={null}
        onDismiss={(value, details) =>
          calls.push({
            event: details.event?.type ?? null,
            reason: details.reason,
            value,
          })
        }
      />,
    );

    await click(required(container, "button"));

    expect(calls).toEqual([
      { event: "click", reason: "dismiss", value: "saved" },
    ]);
  });

  it("requests timeout dismissal after the configured lifetime", async () => {
    const calls: string[] = [];
    await render(
      <Example
        duration={20}
        onDismiss={(_value, details) => calls.push(details.reason)}
      />,
    );

    await act(() => wait(30));

    expect(calls).toEqual(["timeout"]);
  });

  it("pauses toast lifetimes while the pointer is in the region", async () => {
    const calls: string[] = [];
    const container = await render(
      <Example
        duration={30}
        onDismiss={(_value, details) => calls.push(details.reason)}
      />,
    );
    const region = required(container, '[role="region"]');

    await pointer(region, "pointerenter");
    await act(() => wait(40));
    expect(calls).toEqual([]);

    await pointer(region, "pointerleave");
    await act(() => wait(40));
    expect(calls).toEqual(["timeout"]);
  });

  it("pauses toast lifetimes while focus is in the region", async () => {
    const calls: string[] = [];
    const container = await render(
      <Example
        duration={30}
        onDismiss={(_value, details) => calls.push(details.reason)}
      />,
    );
    const dismiss = required(container, "button");
    const outside = document.createElement("button");
    document.body.append(outside);

    await act(() => dismiss.focus());
    await act(() => wait(40));
    expect(calls).toEqual([]);

    await act(() => outside.focus());
    await act(() => wait(40));
    expect(calls).toEqual(["timeout"]);
  });

  it.each(["focus", "pointer"])(
    "keeps the %s pause through a rerender",
    async (kind) => {
      const calls: string[] = [];
      let rerender = () => {};
      function UpdatingToast(): FigNode {
        const [count, setCount] = useState(0);
        rerender = () => setCount(count + 1);
        return (
          <div data-count={count}>
            <Example
              duration={30}
              onDismiss={(_value, details) => calls.push(details.reason)}
            />
          </div>
        );
      }
      const container = await render(<UpdatingToast />);
      if (kind === "focus")
        await act(() => required(container, "button").focus());
      else
        await pointer(required(container, '[role="region"]'), "pointerenter");
      await act(rerender);
      await act(() => wait(50));
      expect(calls).toEqual([]);
      const outside = document.createElement("button");
      document.body.append(outside);
      if (kind === "focus") await act(() => outside.focus());
      else
        await pointer(required(container, '[role="region"]'), "pointerleave");
      await act(() => wait(40));
      expect(calls).toEqual(["timeout"]);
    },
  );

  it.each(["pointer", "focus"])(
    "clears stale %s pause when the region host is replaced",
    async (kind) => {
      const calls: string[] = [];
      let replace = () => {};
      function ChangingRegion(): FigNode {
        const [version, setVersion] = useState(0);
        replace = () => setVersion(version + 1);
        const toast = useToastRegion({
          onDismiss: (_value, details) => calls.push(details.reason),
        });
        return (
          <div key={version} mix={toast.region()}>
            <div mix={toast.toast("saved", { duration: 30 })}>
              <button>Toast action</button>
            </div>
          </div>
        );
      }
      const container = await render(<ChangingRegion />);
      if (kind === "pointer")
        await pointer(required(container, '[role="region"]'), "pointerenter");
      else await act(() => required(container, "button").focus());
      await act(replace);
      await act(() => wait(50));
      expect(calls).toEqual(["timeout"]);
    },
  );

  it("cancels a removed toast's timer", async () => {
    const calls: string[] = [];
    let remove = () => {};
    function Removable(): FigNode {
      const [shown, setShown] = useState(true);
      remove = () => setShown(false);
      return shown ? (
        <Example
          duration={30}
          onDismiss={(_value, details) => calls.push(details.reason)}
        />
      ) : null;
    }
    await render(<Removable />);
    await act(remove);
    await act(() => wait(50));
    expect(calls).toEqual([]);
  });

  it("keeps the original expiration deadline through a rerender", async () => {
    const calls: string[] = [];
    let rerender = () => {};
    function UpdatingToast(): FigNode {
      const [count, setCount] = useState(0);
      rerender = () => setCount(count + 1);
      return (
        <div data-count={count}>
          <Example
            duration={90}
            onDismiss={(_value, details) => calls.push(details.reason)}
          />
        </div>
      );
    }
    await render(<UpdatingToast />);
    await act(() => wait(60));
    await act(rerender);
    await act(() => wait(50));
    expect(calls).toEqual(["timeout"]);
  });

  it("pauses toast lifetimes while the document is hidden", async () => {
    const calls: string[] = [];
    await render(
      <Example
        duration={30}
        onDismiss={(_value, details) => calls.push(details.reason)}
      />,
    );

    await setDocumentHidden(true);
    await act(() => wait(40));
    expect(calls).toEqual([]);

    await setDocumentHidden(false);
    await act(() => wait(40));
    expect(calls).toEqual(["timeout"]);
  });
});

function Example(props: {
  duration?: number | null;
  onDismiss?: ToastDismissHandler<string>;
  priority?: "assertive" | "polite";
}): FigNode {
  const region = useToastRegion<string>({
    onDismiss: props.onDismiss ?? (() => {}),
    priority: props.priority,
  });
  return (
    <div mix={region.region()}>
      <div
        data-toast=""
        mix={region.toast("saved", {
          duration: props.duration,
        })}
      >
        Saved
        <button mix={region.dismiss("saved")}>Dismiss</button>
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

function required(container: Element, selector: string): HTMLElement {
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

async function pointer(element: HTMLElement, type: string): Promise<void> {
  await act(() => element.dispatchEvent(new Event(type, { bubbles: true })));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function setDocumentHidden(hidden: boolean): Promise<void> {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
}
