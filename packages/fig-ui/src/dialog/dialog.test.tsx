// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Dialog,
  type DialogOpenChangeHandler,
  type DialogParts,
  useDialog,
} from "./dialog.tsx";

import { createPartReference } from "../internal/part-reference.ts";
import { createDialogRegistry } from "./registry.ts";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Dialog", () => {
  it("still rejects an unnamed lazy dialog before it becomes modal", () => {
    const registry = createDialogRegistry(() => {});
    const node = document.createElement("dialog");
    document.body.append(node);
    const controller = new AbortController();
    registry.bindDialog(node, controller.signal, {
      title: createPartReference(
        { type: "dialog", props: {}, owns: () => true },
        "aria-labelledby",
      ),
      description: createPartReference(
        { type: "dialog", props: {}, owns: () => true },
        "aria-describedby",
      ),
    });
    expect(() => registry.sync(false)).not.toThrow();
    expect(() => registry.sync(true)).toThrow("requires an accessible name");
    expect(node.open).toBe(false);
    controller.abort();
  });

  it("opens the native element and names it from its own parts", async () => {
    const container = await renderDialog({});
    const dialog = dialogElement(container);
    const trigger = requiredElement(container, "[data-trigger]");
    const title = requiredElement(container, "[data-title]");
    const description = requiredElement(container, "[data-description]");

    expect(dialog.open).toBe(false);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id);

    await click(trigger);

    // The platform owns modality, focus containment, and the top layer.
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute("data-open")).toBe(true);
    expect(trigger.hasAttribute("data-open")).toBe(true);
  });

  it("mounts lazy content before opening and clears its references when closed", async () => {
    function LazyDialog(): FigNode {
      const dialog = useDialog();
      return (
        <>
          <button data-trigger="" mix={dialog.trigger()}>
            Settings
          </button>
          <dialog data-dialog="" mix={dialog.dialog()}>
            {dialog.open ? (
              <>
                <h2 id="lazy-title" mix={dialog.title()}>
                  Settings
                </h2>
                <p id="lazy-description" mix={dialog.description()}>
                  Preferences
                </p>
                <button data-close="" mix={dialog.dismiss()}>
                  Done
                </button>
              </>
            ) : null}
          </dialog>
        </>
      );
    }
    const container = await render(<LazyDialog />);
    const node = dialogElement(container);
    expect(node.open).toBe(false);
    expect(node.hasAttribute("aria-labelledby")).toBe(false);
    for (let index = 0; index < 2; index++) {
      await click(requiredElement(container, "[data-trigger]"));
      expect(node.open).toBe(true);
      expect(node.getAttribute("aria-labelledby")).toBe("lazy-title");
      expect(node.getAttribute("aria-describedby")).toBe("lazy-description");
      await click(requiredElement(container, "[data-close]"));
      expect(node.open).toBe(false);
      expect(node.children.length).toBe(0);
      expect(node.hasAttribute("aria-labelledby")).toBe(false);
      expect(node.hasAttribute("aria-describedby")).toBe(false);
    }
  });

  it("updates custom title and description references after a rerender", async () => {
    let rename = () => {};
    function RenamedDialog(): FigNode {
      const dialog = useDialog();
      const [suffix, setSuffix] = useState("before");
      rename = () => setSuffix("after");
      return (
        <dialog data-dialog="" mix={dialog.dialog()}>
          <h2 id={`title-${suffix}`} mix={dialog.title()}>
            Settings
          </h2>
          <p id={`description-${suffix}`} mix={dialog.description()}>
            Edit settings
          </p>
        </dialog>
      );
    }
    const container = await render(<RenamedDialog />);
    await act(rename);
    expect(dialogElement(container).getAttribute("aria-labelledby")).toBe(
      "title-after",
    );
    expect(dialogElement(container).getAttribute("aria-describedby")).toBe(
      "description-after",
    );
  });

  it("removes a custom description reference when its part unmounts", async () => {
    let hide = () => {};
    function ChangingDescription(): FigNode {
      const dialog = useDialog();
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return (
        <dialog data-dialog="" mix={dialog.dialog()}>
          <h2 mix={dialog.title()}>Settings</h2>
          {shown ? (
            <p id="custom-description" mix={dialog.description()}>
              Edit settings
            </p>
          ) : null}
        </dialog>
      );
    }
    const container = await render(<ChangingDescription />);
    expect(dialogElement(container).getAttribute("aria-describedby")).toBe(
      "custom-description",
    );
    await act(hide);
    expect(dialogElement(container).hasAttribute("aria-describedby")).toBe(
      false,
    );
  });

  it("closes from a dismiss control and reports the change", async () => {
    const changes: Array<{ event: string | null; open: boolean }> = [];
    const container = await renderDialog({
      defaultOpen: true,
      onOpenChange: (open, details) =>
        changes.push({ event: details.event?.type ?? null, open }),
    });
    const dialog = dialogElement(container);
    expect(dialog.open).toBe(true);

    await click(requiredElement(container, "[data-dismiss]"));

    expect(dialog.open).toBe(false);
    // One dismissal reports once, even though the element emits `close` too.
    expect(changes).toEqual([{ event: "click", open: false }]);
  });

  it("closes on Escape and lets the handler keep it open", async () => {
    let cancelNext = false;
    const container = await renderDialog({
      defaultOpen: true,
      onOpenChange: (_open, details) => {
        if (cancelNext) details.cancel();
      },
    });
    const dialog = dialogElement(container);

    cancelNext = true;
    const kept = await escape(dialog);
    expect(kept.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);

    cancelNext = false;
    const dismissed = await escape(dialog);
    expect(dismissed.defaultPrevented).toBe(false);
    expect(dialog.open).toBe(false);
  });

  it("keeps Escape from closing when the option is off", async () => {
    const container = await renderDialog({
      closeOnEscape: false,
      defaultOpen: true,
    });
    const dialog = dialogElement(container);

    const event = await escape(dialog);

    expect(event.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
  });

  it("dismisses a backdrop click but not a click on the dialog's padding", async () => {
    const container = await renderDialog({ defaultOpen: true });
    const dialog = dialogElement(container);
    mockRect(dialog, 100, 100, 200, 200);

    await clickAt(dialog, 150, 150);
    expect(dialog.open).toBe(true);

    await clickAt(dialog, 10, 10);
    expect(dialog.open).toBe(false);
  });

  it.each(["content", "padding"])(
    "does not dismiss a drag that starts on dialog %s",
    async (target) => {
      const container = await renderDialog({ defaultOpen: true });
      const dialog = dialogElement(container);
      mockRect(dialog, 100, 100, 200, 200);
      const start =
        target === "content"
          ? requiredElement(container, "[data-title]")
          : dialog;
      await act(() =>
        start.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 150,
            clientY: 150,
            button: 0,
          }),
        ),
      );
      await act(() =>
        dialog.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 10,
            clientY: 10,
            button: 0,
          }),
        ),
      );
      await clickAt(dialog, 10, 10);
      expect(dialog.open).toBe(true);
      // A later complete backdrop gesture must still dismiss normally.
      await act(() =>
        dialog.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 10,
            clientY: 10,
            button: 0,
          }),
        ),
      );
      await clickAt(dialog, 10, 10);
      expect(dialog.open).toBe(false);
    },
  );

  it("keeps a backdrop click from closing when the option is off", async () => {
    const container = await renderDialog({
      closeOnBackdrop: false,
      defaultOpen: true,
    });
    const dialog = dialogElement(container);
    mockRect(dialog, 100, 100, 200, 200);

    await clickAt(dialog, 10, 10);

    expect(dialog.open).toBe(true);
  });

  it("follows a native close it did not start", async () => {
    const changes: boolean[] = [];
    const container = await renderDialog({
      defaultOpen: true,
      onOpenChange: (open) => changes.push(open),
    });
    const dialog = dialogElement(container);

    // A form submitted with method="dialog" closes the element directly.
    await act(() => dialog.close());

    expect(dialog.open).toBe(false);
    expect(changes).toEqual([false]);

    // State followed the element, so the trigger opens it again.
    await click(requiredElement(container, "[data-trigger]"));
    expect(dialog.open).toBe(true);
  });

  it("reopens a controlled dialog the platform closed", async () => {
    const container = await render(
      <Dialog onOpenChange={() => undefined} open={true}>
        {(dialog) => (
          <dialog data-dialog="" mix={dialog.dialog()}>
            <h2 mix={dialog.title()}>Confirm</h2>
          </dialog>
        )}
      </Dialog>,
    );
    const dialog = dialogElement(container);
    expect(dialog.open).toBe(true);

    // The owner kept `open` true, so the next pass restores modality.
    await act(() => dialog.close());

    expect(dialog.open).toBe(true);
  });

  it("opens and closes without an activation event", async () => {
    const changes: Array<{ event: string | null; open: boolean }> = [];
    let parts: DialogParts | undefined;

    function ProgrammaticDialog(): FigNode {
      const dialog = useDialog({
        onOpenChange: (open, details) =>
          changes.push({ event: details.event?.type ?? null, open }),
      });
      parts = dialog;
      return (
        <dialog data-dialog="" mix={dialog.dialog()}>
          <h2 mix={dialog.title()}>Confirm</h2>
        </dialog>
      );
    }

    const container = await render(<ProgrammaticDialog />);
    const dialog = dialogElement(container);

    await act(() => parts?.setOpen(true));
    expect(dialog.open).toBe(true);
    expect(changes).toEqual([{ event: null, open: true }]);

    await act(() => parts?.setOpen(false));
    expect(dialog.open).toBe(false);
  });

  it("relabels when a descendant remounts the title", async () => {
    function DescendantDialog(): FigNode {
      const dialog = useDialog({ defaultOpen: true });
      return (
        <dialog data-dialog="" mix={dialog.dialog()}>
          <Header dialog={dialog} />
        </dialog>
      );
    }

    function Header({ dialog }: { dialog: DialogParts }): FigNode {
      return (
        <h2 data-title="" id="custom-title" mix={dialog.title()}>
          Confirm
        </h2>
      );
    }

    const container = await render(<DescendantDialog />);

    // The caller's own id wins, and the dialog follows it.
    expect(requiredElement(container, "[data-title]").id).toBe("custom-title");
    expect(dialogElement(container).getAttribute("aria-labelledby")).toBe(
      "custom-title",
    );
  });

  it("preserves an explicit accessible-name relationship", async () => {
    const container = await render(
      <Dialog>
        {(dialog) => (
          <>
            <h2 id="external-title">Confirm</h2>
            <dialog
              aria-labelledby="external-title"
              data-dialog=""
              mix={dialog.dialog()}
            >
              <h3 mix={dialog.title()}>Internal fallback</h3>
            </dialog>
          </>
        )}
      </Dialog>,
    );

    expect(dialogElement(container).getAttribute("aria-labelledby")).toBe(
      "external-title",
    );
  });

  it("lets an explicit aria-label override the title part", async () => {
    const container = await render(
      <Dialog>
        {(dialog) => (
          <dialog
            aria-label="Confirmation"
            data-dialog=""
            mix={dialog.dialog()}
          >
            <h2 mix={dialog.title()}>Internal fallback</h2>
          </dialog>
        )}
      </Dialog>,
    );
    const element = dialogElement(container);

    expect(element.getAttribute("aria-label")).toBe("Confirmation");
    expect(element.hasAttribute("aria-labelledby")).toBe(false);
  });
});

interface ExampleDialogProps {
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: DialogOpenChangeHandler;
}

function ExampleDialog(props: ExampleDialogProps): FigNode {
  const dialog = useDialog(props);

  return (
    <div>
      <button data-trigger="" mix={dialog.trigger()}>
        Open
      </button>
      <dialog data-dialog="" mix={dialog.dialog()}>
        <h2 data-title="" mix={dialog.title()}>
          Confirm
        </h2>
        <p data-description="" mix={dialog.description()}>
          This cannot be undone.
        </p>
        <button data-dismiss="" mix={dialog.dismiss()}>
          Cancel
        </button>
      </dialog>
    </div>
  );
}

async function renderDialog(props: ExampleDialogProps): Promise<HTMLElement> {
  return render(<ExampleDialog {...props} />);
}

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}

function dialogElement(container: Element): HTMLDialogElement {
  const element = container.querySelector<HTMLDialogElement>("[data-dialog]");
  if (element === null) throw new Error("Expected a dialog.");
  return element;
}

function requiredElement(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

async function click(element: HTMLElement): Promise<MouseEvent> {
  return clickAt(element, 0, 0);
}

async function clickAt(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): Promise<MouseEvent> {
  const event = new MouseEvent("click", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX,
    clientY,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

async function escape(dialog: HTMLDialogElement): Promise<Event> {
  // The platform delivers Escape as a cancelable `cancel`, then closes.
  const event = new Event("cancel", { cancelable: true });
  await act(() => {
    dialog.dispatchEvent(event);
    if (!event.defaultPrevented) dialog.close();
  });
  return event;
}

function mockRect(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  });
}
