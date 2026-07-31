// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  RadioGroup,
  type RadioGroupParts,
  type RadioGroupValueChangeDetails,
  type RadioGroupValueChangeHandler,
  useRadioGroup,
} from "./radio-group.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

// Arrow movement, the roving tab stop, wrapping, skipping disabled radios,
// and Space all belong to the browser once radios share a name, so they are
// covered against a real one in the end-to-end suite rather than mocked here.
describe("RadioGroup", () => {
  it("groups native inputs under one generated name", async () => {
    const container = await renderGroup({ defaultValue: "medium" });
    const group = requiredElement(container, '[role="radiogroup"]');
    const [small, medium] = radios(container);

    expect(group.getAttribute("aria-orientation")).toBe("vertical");
    expect(small.type).toBe("radio");
    expect(small.name).toBe(medium.name);
    expect(small.name).not.toBe("");
    expect(small.value).toBe("small");
    expect(medium.checked).toBe(true);
    expect(small.checked).toBe(false);
    expect(medium.hasAttribute("data-checked")).toBe(true);

    // The platform owns the tab stop, so the widget sets no tabindex at all.
    expect(small.hasAttribute("tabindex")).toBe(false);
    expect(medium.hasAttribute("tabindex")).toBe(false);
  });

  it("reports the change the platform made", async () => {
    const changes: Array<{
      details: RadioGroupValueChangeDetails;
      value: string | null;
    }> = [];
    const container = await renderGroup({
      onValueChange: (value, details) => changes.push({ details, value }),
    });
    const [, medium] = radios(container);

    await check(medium);

    expect(medium.checked).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.value).toBe("medium");
    expect(changes[0]?.details.event?.type).toBe("change");
    expect(changes[0]?.details.trigger).toBe(medium);
  });

  it("keeps the latest rapid native selection", async () => {
    const container = await renderGroup({ defaultValue: "small" });
    const [small, medium, large] = radios(container);

    await act(() => {
      for (const radio of [medium, large, small]) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(radios(container).map((radio) => radio.checked)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("submits the checked value with the form", async () => {
    const container = await render(
      <form data-form="">
        <ExampleGroup defaultValue="medium" name="size" />
      </form>,
    );
    const form = requiredElement(container, "[data-form]") as HTMLFormElement;

    expect(new FormData(form).get("size")).toBe("medium");

    await check(radios(container)[2]);

    expect(new FormData(form).get("size")).toBe("large");
  });

  it("returns uncontrolled state to its native form default", async () => {
    const container = await render(
      <form data-form="">
        <ExampleGroup defaultValue="medium" name="size" />
      </form>,
    );
    const form = requiredElement(container, "[data-form]") as HTMLFormElement;
    await check(radios(container)[2]);

    await act(async () => {
      form.reset();
      await Promise.resolve();
    });

    expect(radios(container).map((radio) => radio.checked)).toEqual([
      false,
      true,
      false,
    ]);
    expect(new FormData(form).get("size")).toBe("medium");
  });

  it("marks the group required for validation", async () => {
    const container = await renderGroup({ required: true });

    expect(radios(container).every((radio) => radio.required)).toBe(true);
  });

  it("disables radios natively so the browser skips them", async () => {
    const container = await renderGroup({ disabledValue: "medium" });
    const [small, medium] = radios(container);

    // Native disabled, not aria-disabled: the browser takes it out of the
    // group's arrow order and out of submission.
    expect(medium.disabled).toBe(true);
    expect(medium.hasAttribute("aria-disabled")).toBe(false);
    expect(small.disabled).toBe(false);
  });

  it("disables every radio when the group is disabled", async () => {
    const container = await renderGroup({ disabled: true });

    expect(radios(container).every((radio) => radio.disabled)).toBe(true);
    expect(requiredElement(container, '[role="radiogroup"]')).toHaveProperty(
      "dataset.disabled",
      "",
    );
  });

  it("keeps a read-only group focusable, submitted, and unchanged", async () => {
    const changes: Array<string | null> = [];
    const container = await render(
      <form data-form="">
        <ExampleGroup
          defaultValue="small"
          name="size"
          onValueChange={(value) => changes.push(value)}
          readOnly={true}
        />
      </form>,
    );
    const form = requiredElement(container, "[data-form]") as HTMLFormElement;
    const [small, medium] = radios(container);

    await check(medium);

    expect(small.checked).toBe(true);
    expect(medium.checked).toBe(false);
    expect(radios(container).every((radio) => !radio.disabled)).toBe(true);
    expect(
      requiredElement(container, '[role="radiogroup"]').getAttribute(
        "aria-readonly",
      ),
    ).toBe("true");
    expect(new FormData(form).get("size")).toBe("small");
    expect(changes).toEqual([]);
  });

  it("lets a controlled group refuse a change", async () => {
    const changes: Array<string | null> = [];
    const container = await render(
      <RadioGroup<string>
        onValueChange={(value, details) => {
          changes.push(value);
          details.cancel();
        }}
        value="small"
      >
        {(group) => (
          <div aria-label="Size" mix={group.root()}>
            <input mix={group.radio("small")} />
            <input mix={group.radio("medium")} />
          </div>
        )}
      </RadioGroup>,
    );
    const [small, medium] = radios(container);

    await check(medium);

    expect(changes).toEqual(["medium"]);
    // The owner kept its value, so the committed prop re-asserts.
    expect(small.checked).toBe(true);
    expect(medium.checked).toBe(false);
  });

  // A caller's own `value` prop winning over the generated one is covered in
  // the browser suite rather than here: happy-dom does not implement the step
  // that moves an input's value into its content attribute when the type
  // changes, so a value composed before the type looks lost here when it is
  // not.
  it("takes a caller's own name", async () => {
    const container = await render(
      <RadioGroup<string> defaultValue="a" name="plan">
        {(group) => (
          <div aria-label="Plan" mix={group.root()}>
            <input mix={group.radio("a")} />
            <input mix={group.radio("b")} />
          </div>
        )}
      </RadioGroup>,
    );

    expect(radios(container).every((radio) => radio.name === "plan")).toBe(
      true,
    );
  });

  it("selects radios a descendant component owns", async () => {
    function DescendantGroup(): FigNode {
      const group = useRadioGroup<string>({ defaultValue: "small" });
      return (
        <div aria-label="Size" mix={group.root()}>
          <Options group={group} />
        </div>
      );
    }

    function Options({ group }: { group: RadioGroupParts<string> }): FigNode {
      const [values] = useState<readonly string[]>(["small", "medium"]);
      return (
        <>
          {values.map((value) => (
            <input mix={group.radio(value)} />
          ))}
        </>
      );
    }

    const container = await render(<DescendantGroup />);
    const [, medium] = radios(container);

    await check(medium);

    expect(medium.checked).toBe(true);
  });

  it("leaves an unrelated group alone", async () => {
    const changes: Array<string | null> = [];
    const container = await render(
      <div>
        <ExampleGroup onValueChange={(value) => changes.push(value)} />
        <RadioGroup<string> defaultValue="x">
          {(group) => (
            <div aria-label="Other" mix={group.root()}>
              <input data-other="" mix={group.radio("x")} />
            </div>
          )}
        </RadioGroup>
      </div>,
    );

    await check(requiredElement(container, "[data-other]") as HTMLInputElement);

    expect(changes).toEqual([]);
  });
});

interface ExampleGroupProps {
  defaultValue?: string;
  disabled?: boolean;
  disabledValue?: string;
  name?: string;
  onValueChange?: RadioGroupValueChangeHandler<string>;
  readOnly?: boolean;
  required?: boolean;
}

function ExampleGroup(props: ExampleGroupProps): FigNode {
  const group = useRadioGroup<string>({
    defaultValue: props.defaultValue,
    disabled: props.disabled,
    name: props.name,
    onValueChange: props.onValueChange,
    readOnly: props.readOnly,
    required: props.required,
  });

  return (
    <div aria-label="Size" mix={group.root()}>
      {(["small", "medium", "large"] as const).map((value) => (
        <input
          mix={group.radio(value, { disabled: props.disabledValue === value })}
        />
      ))}
    </div>
  );
}

async function renderGroup(props: ExampleGroupProps): Promise<HTMLElement> {
  return render(<ExampleGroup {...props} />);
}

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}

function radios(container: Element): HTMLInputElement[] {
  return [
    ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];
}

function requiredElement(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}

/** What the browser does when a radio is chosen: check it, then report. */
async function check(radio: HTMLInputElement): Promise<void> {
  await act(() => {
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
