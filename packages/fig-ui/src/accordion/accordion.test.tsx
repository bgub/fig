// @vitest-environment happy-dom
import {
  type FigNode,
  useState,
  useTransition,
  ViewTransition,
} from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";
import { afterEach, describe, expect, it } from "vitest";
import {
  Accordion,
  type AccordionParts,
  type AccordionValueChangeHandler,
  useAccordion,
} from "./accordion.tsx";

const roots: FigRoot[] = [];

enableViewTransitions();

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Accordion", () => {
  it("connects headers and regions", async () => {
    const container = await renderAccordion({ defaultValue: ["shipping"] });
    const [shipping, billing] = triggers(container);
    const [shippingPanel, billingPanel] = panels(container);

    expect(shipping.type).toBe("button");
    expect(shipping.getAttribute("aria-expanded")).toBe("true");
    expect(shipping.getAttribute("aria-controls")).toBe(shippingPanel.id);
    expect(shippingPanel.getAttribute("role")).toBe("region");
    expect(shippingPanel.getAttribute("aria-labelledby")).toBe(shipping.id);
    expect(shippingPanel.hidden).toBe(false);
    expect(billing.getAttribute("aria-expanded")).toBe("false");
    expect(billingPanel.hidden).toBe(true);
    // Headers stay in the tab order rather than sharing one roving stop.
    expect(shipping.tabIndex).toBe(0);
    expect(billing.tabIndex).toBe(0);
  });

  it("opens one panel at a time and collapses the open one", async () => {
    const changes: Array<readonly string[]> = [];
    const container = await renderAccordion({
      defaultValue: ["shipping"],
      onValueChange: (values) => changes.push(values),
    });
    const [shipping, billing] = triggers(container);

    await click(billing);
    expect(billing.getAttribute("aria-expanded")).toBe("true");
    expect(shipping.getAttribute("aria-expanded")).toBe("false");
    expect(changes.at(-1)).toEqual(["billing"]);

    await click(billing);
    expect(billing.getAttribute("aria-expanded")).toBe("false");
    expect(changes.at(-1)).toEqual([]);
  });

  it("keeps one panel open when it is not collapsible", async () => {
    const container = await renderAccordion({
      collapsible: false,
      defaultValue: ["shipping"],
    });
    const [shipping] = triggers(container);

    await click(shipping);

    expect(shipping.getAttribute("aria-expanded")).toBe("true");
  });

  it("holds several panels open in multiple mode", async () => {
    const container = await renderAccordion({
      defaultValue: ["shipping"],
      multiple: true,
    });
    const [shipping, billing] = triggers(container);

    await click(billing);

    expect(shipping.getAttribute("aria-expanded")).toBe("true");
    expect(billing.getAttribute("aria-expanded")).toBe("true");
    expect(
      panels(container)
        .filter((panel) => !panel.hidden)
        .map((panel) => panel.textContent),
    ).toEqual(["shipping panel", "billing panel"]);
  });

  it("moves between headers with arrows, Home, and End without wrapping", async () => {
    const container = await renderAccordion({});
    const [shipping, billing, returns] = triggers(container);

    shipping.focus();
    await keydown(shipping, "ArrowDown");
    expect(document.activeElement).toBe(billing);

    await keydown(billing, "End");
    expect(document.activeElement).toBe(returns);

    await keydown(returns, "ArrowDown");
    expect(document.activeElement).toBe(returns);

    await keydown(returns, "Home");
    expect(document.activeElement).toBe(shipping);

    // The horizontal axis stays inert for a vertical accordion.
    const sideways = await keydown(shipping, "ArrowRight");
    expect(sideways.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(shipping);
  });

  it("keeps disabled headers focusable without toggling them", async () => {
    const changes: Array<readonly string[]> = [];
    const container = await renderAccordion({
      disabledValue: "billing",
      onValueChange: (values) => changes.push(values),
    });
    const [shipping, billing] = triggers(container);

    expect(billing.getAttribute("aria-disabled")).toBe("true");
    expect(billing.hasAttribute("disabled")).toBe(false);

    shipping.focus();
    await keydown(shipping, "ArrowDown");
    expect(document.activeElement).toBe(billing);

    const blocked = await click(billing);
    expect(blocked.defaultPrevented).toBe(true);
    expect(changes).toEqual([]);
  });

  it("lets a controlled accordion cancel a change", async () => {
    const container = await render(
      <Accordion<string>
        onValueChange={(_values, details) => details.cancel()}
        value={[]}
      >
        {(accordion) => (
          <div mix={accordion.root()}>
            <h3>
              <button mix={accordion.trigger("shipping")}>Shipping</button>
            </h3>
            <section mix={accordion.panel("shipping")}>Shipping panel</section>
          </div>
        )}
      </Accordion>,
    );
    const [shipping] = triggers(container);

    await click(shipping);

    expect(shipping.getAttribute("aria-expanded")).toBe("false");
  });

  it("unmounts closed rendered panels and animates the open one", async () => {
    const container = await render(<TransitionAccordion />);
    const ownerDocument = document as unknown as TransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const previousPending = ownerDocument.__figViewTransition;
    const types: string[][] = [];
    const captured: string[][] = [];
    ownerDocument.startViewTransition = (input) => {
      const options = typeof input === "function" ? { update: input } : input;
      types.push(options.types ?? []);
      options.update();
      captured.push(
        [...container.querySelectorAll<HTMLElement>("*")]
          .filter((element) => Boolean(element.style.viewTransitionName))
          .map((element) => element.style.viewTransitionName),
      );
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        skipTransition() {},
      } as ViewTransition;
    };

    try {
      expect(panels(container)).toHaveLength(0);

      await click(triggers(container)[0]);
      expect(panels(container).map((panel) => panel.textContent)).toEqual([
        "Shipping panel",
      ]);
      expect(types).toEqual([["accordion-change"]]);
      expect(captured).toEqual([["accordion-frame"]]);

      await click(triggers(container)[0]);
      expect(panels(container)).toHaveLength(0);
      expect(types.at(-1)).toEqual(["accordion-change"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = previousPending;
    }
  });

  it("relabels regions when a descendant remounts a header", async () => {
    function DescendantAccordion(): FigNode {
      const accordion = useAccordion<string>({ defaultValue: ["billing"] });
      return (
        <div mix={accordion.root()}>
          <Sections accordion={accordion} />
        </div>
      );
    }

    function Sections({
      accordion,
    }: {
      accordion: AccordionParts<string>;
    }): FigNode {
      const [values, setValues] = useState<readonly string[]>([
        "shipping",
        "billing",
      ]);
      return (
        <>
          <button data-drop="" mix={on("click", () => setValues(["billing"]))}>
            Drop
          </button>
          {values.map((value) => (
            <>
              <h3>
                <button mix={accordion.trigger(value)}>{value}</button>
              </h3>
              <section mix={accordion.panel(value)}>{value} panel</section>
            </>
          ))}
        </>
      );
    }

    const container = await render(<DescendantAccordion />);
    expect(triggers(container)).toHaveLength(2);

    await click(requiredElement(container, "[data-drop]"));

    const [billing] = triggers(container);
    const [billingPanel] = panels(container);
    expect(triggers(container)).toHaveLength(1);
    expect(billing.getAttribute("aria-controls")).toBe(billingPanel.id);
    expect(billingPanel.getAttribute("aria-labelledby")).toBe(billing.id);
  });
});

interface ExampleAccordionProps {
  collapsible?: boolean;
  defaultValue?: readonly string[];
  disabledValue?: string;
  multiple?: boolean;
  onValueChange?: AccordionValueChangeHandler<string>;
}

function ExampleAccordion(props: ExampleAccordionProps): FigNode {
  const accordion = useAccordion<string>({
    collapsible: props.collapsible,
    defaultValue: props.defaultValue,
    multiple: props.multiple,
    onValueChange: props.onValueChange,
  });

  return (
    <div mix={accordion.root()}>
      {(["shipping", "billing", "returns"] as const).map((value) => (
        <>
          <h3>
            <button
              mix={accordion.trigger(value, {
                disabled: props.disabledValue === value,
              })}
            >
              {value}
            </button>
          </h3>
          <section mix={accordion.panel(value)}>{value} panel</section>
        </>
      ))}
    </div>
  );
}

function TransitionAccordion(): FigNode {
  const [values, setValues] = useState<readonly string[]>([]);
  const [, startTransition] = useTransition();
  const accordion = useAccordion<string>({
    onValueChange: (next) => {
      startTransition(() => setValues(next), {
        types: ["accordion-change"],
        viewTransition: "interrupt",
      });
    },
    value: values,
  });

  return (
    <div mix={accordion.root()}>
      <h3>
        <button mix={accordion.trigger("shipping")}>Shipping</button>
      </h3>
      <ViewTransition name="accordion-frame">
        <div>
          {accordion.isOpen("shipping") ? (
            <section mix={accordion.panel("shipping")}>Shipping panel</section>
          ) : null}
        </div>
      </ViewTransition>
    </div>
  );
}

async function renderAccordion(
  props: ExampleAccordionProps,
): Promise<HTMLElement> {
  return render(<ExampleAccordion {...props} />);
}

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}

function triggers(container: Element): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[data-fig-accordion-trigger]",
    ),
  ];
}

function panels(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="region"]')];
}

function requiredElement(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

async function click(element: HTMLElement): Promise<MouseEvent> {
  const event = new MouseEvent("click", {
    bubbles: true,
    button: 0,
    cancelable: true,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

async function keydown(
  element: HTMLElement,
  key: string,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}

type TransitionInput = (() => void) | { types?: string[]; update: () => void };

interface TransitionDocument {
  __figViewTransition?: unknown;
  startViewTransition?: (input: TransitionInput) => ViewTransition;
}
