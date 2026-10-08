// @vitest-environment happy-dom
import { createMixin, type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useCheckbox } from "../checkbox/checkbox.tsx";
import { useRadioGroup } from "../radio-group/radio-group.tsx";
import { useSwitch } from "../switch/switch.tsx";
import { useCombobox } from "../combobox/combobox.tsx";
import { Field, useField } from "./field.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Field", () => {
  it("orders keyed messages by committed DOM order while preserving reference groups", async () => {
    let reverse = () => {};
    function Example(): FigNode {
      const [reversed, setReversed] = useState(false);
      reverse = () => setReversed(true);
      const field = useField({ invalid: true });
      const keys = reversed ? ["b", "a"] : ["a", "b"];
      return (
        <div>
          <label mix={field.label()}>Name</label>
          <span id="external">Help</span>
          <input aria-describedby="external" mix={field.control()} />
          {keys.map((key) => (
            <div key={key}>
              <p id={`error-${key}`} mix={field.error(key)}>
                Error
              </p>
              <p id={`description-${key}`} mix={field.description(key)}>
                Description
              </p>
            </div>
          ))}
        </div>
      );
    }
    const container = await render(<Example />);
    const input = required(container, "input");
    const firstDescription = required(container, "#description-a");
    expect(input.getAttribute("aria-describedby")).toBe(
      "external description-a description-b error-a error-b",
    );
    await act(reverse);
    expect([...container.querySelectorAll("p")].map((node) => node.id)).toEqual(
      ["error-b", "description-b", "error-a", "description-a"],
    );
    expect(required(container, "#description-a")).toBe(firstDescription);
    expect(input.getAttribute("aria-describedby")).toBe(
      "external description-b description-a error-b error-a",
    );
  });

  it("ties a label and description to the control", async () => {
    const container = await render(<Example />);
    const label = required(container, "label");
    const input = required(container, "input");
    const description = required(container, "[data-description]");

    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("aria-labelledby")).toBe(label.id);
    expect(input.getAttribute("aria-describedby")).toBe(description.id);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("adds an error message to what describes the control", async () => {
    const container = await render(<Example invalid={true} />);
    const input = required(container, "input");
    const description = required(container, "[data-description]");
    const error = required(container, "[data-error]");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Both, in the order they are rendered, so the message is read last.
    expect(input.getAttribute("aria-describedby")).toBe(
      `${description.id} ${error.id}`,
    );
  });

  it("composes authored and repeated descriptions with errors last", async () => {
    const container = await render(
      <Field invalid={true}>
        {(field) => (
          <div>
            <label mix={field.label()}>Password</label>
            <span id="external-help">Use your account password.</span>
            <input aria-describedby="external-help" mix={field.control()} />
            <p data-description="first" mix={field.description("requirements")}>
              At least twelve characters.
            </p>
            <p data-description="second" mix={field.description("privacy")}>
              Never shared.
            </p>
            <p data-error="" mix={field.error("short")}>
              Too short.
            </p>
          </div>
        )}
      </Field>,
    );
    const input = required(container, "input");
    const descriptions = [
      ...container.querySelectorAll<HTMLElement>("[data-description]"),
    ];
    const error = required(container, "[data-error]");

    expect(input.getAttribute("aria-describedby")).toBe(
      `external-help ${descriptions[0].id} ${descriptions[1].id} ${error.id}`,
    );
    expect(new Set(descriptions.map((node) => node.id)).size).toBe(2);
  });

  it("does not reference a mounted error until the field is invalid", async () => {
    const container = await render(
      <Field invalid={false}>
        {(field) => (
          <div>
            <label mix={field.label()}>Email</label>
            <input mix={field.control()} />
            <p data-error="" mix={field.error()}>
              Required
            </p>
          </div>
        )}
      </Field>,
    );

    expect(required(container, "input").hasAttribute("aria-describedby")).toBe(
      false,
    );
  });

  it("references only the parts the caller actually rendered", async () => {
    const container = await render(
      <Field>
        {(field) => (
          <div>
            <label mix={field.label()}>Email</label>
            <input mix={field.control()} />
          </div>
        )}
      </Field>,
    );

    expect(required(container, "input").hasAttribute("aria-describedby")).toBe(
      false,
    );
  });

  it("follows caller-owned control and label ids", async () => {
    const container = await render(
      <Field>
        {(field) => (
          <div>
            <label id="email-label" mix={field.label()}>
              Email
            </label>
            <input id="email-control" mix={field.control()} />
          </div>
        )}
      </Field>,
    );
    const label = required(container, "label");
    const input = required(container, "input");

    expect(label.getAttribute("for")).toBe("email-control");
    expect(input.getAttribute("aria-labelledby")).toBe("email-label");
  });

  it("updates label relationships when custom ids change", async () => {
    let rename = () => {};
    function RenamedField(): FigNode {
      const field = useField();
      const [suffix, setSuffix] = useState("before");
      rename = () => setSuffix("after");
      return (
        <>
          <label id={`label-${suffix}`} mix={field.label()}>
            Email
          </label>
          <input id={`control-${suffix}`} mix={field.control()} />
        </>
      );
    }
    const container = await render(<RenamedField />);
    await act(rename);
    expect(required(container, "label").getAttribute("for")).toBe(
      "control-after",
    );
    expect(required(container, "input").getAttribute("aria-labelledby")).toBe(
      "label-after",
    );
  });

  it("preserves authored label relationships across id changes", async () => {
    let rename = () => {};
    function AuthoredField(): FigNode {
      const field = useField();
      const [suffix, setSuffix] = useState("before");
      rename = () => setSuffix("after");
      return (
        <>
          <span id="external-label">External label</span>
          <label
            id={`label-${suffix}`}
            for="external-control"
            mix={field.label()}
          >
            Email
          </label>
          <input
            id={`control-${suffix}`}
            aria-labelledby="external-label"
            mix={field.control()}
          />
        </>
      );
    }
    const container = await render(<AuthoredField />);
    await act(rename);
    expect(required(container, "label").getAttribute("for")).toBe(
      "external-control",
    );
    expect(required(container, "input").getAttribute("aria-labelledby")).toBe(
      "external-label",
    );
  });

  it("honors label overrides from later mixins", async () => {
    const labelOverride = createMixin(() => ({ for: "other-control" }));
    const controlOverride = createMixin(() => ({
      "aria-labelledby": "other-label",
    }));
    const container = await render(
      <Field>
        {(field) => (
          <>
            <span id="other-label">External</span>
            <label mix={[field.label(), labelOverride()]}>Local</label>
            <input mix={[field.control(), controlOverride()]} />
          </>
        )}
      </Field>,
    );
    expect(required(container, "label").getAttribute("for")).toBe(
      "other-control",
    );
    expect(required(container, "input").getAttribute("aria-labelledby")).toBe(
      "other-label",
    );
  });

  it("follows an error that appears after a descendant renders it", async () => {
    function LateError(): FigNode {
      const field = useField({ invalid: true });
      const [shown, setShown] = useState(false);
      return (
        <div>
          <label mix={field.label()}>Email</label>
          <input mix={field.control()} />
          <button data-show="" mix={on("click", () => setShown(true))}>
            Show
          </button>
          {shown ? (
            <p data-error="" mix={field.error()}>
              Required
            </p>
          ) : null}
        </div>
      );
    }

    const container = await render(<LateError />);
    expect(required(container, "input").hasAttribute("aria-describedby")).toBe(
      false,
    );

    await act(() =>
      required(container, "[data-show]").dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      ),
    );

    expect(required(container, "input").getAttribute("aria-describedby")).toBe(
      required(container, "[data-error]").id,
    );
  });

  it("passes disabled and required to the control", async () => {
    const container = await render(<Example disabled={true} required={true} />);
    const input = required(container, "input") as HTMLInputElement;

    expect(input.disabled).toBe(true);
    expect(input.required).toBe(true);
  });
});

function Example(props: {
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}): FigNode {
  const field = useField(props);
  return (
    <div data-root="">
      <label mix={field.label()}>Email</label>
      <input mix={field.control()} />
      <p data-description="" mix={field.description()}>
        We only use it to sign you in.
      </p>
      {props.invalid === true ? (
        <p data-error="" mix={field.error()}>
          Enter an email address.
        </p>
      ) : null}
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

for (const source of ["field", "host", "widget"] as const) {
  it.each(["checkbox", "switch", "radio", "combobox", "native"])(
    `preserves and clears ${source} constraints on %s controls`,
    async (kind) => {
      let setConstrained: (value: boolean) => void = () => {};
      function ComposedField(): FigNode {
        const [constrained, set] = useState(true);
        setConstrained = set;
        const constraints = { disabled: constrained, required: constrained };
        const field = useField(source === "field" ? constraints : {});
        const checkbox = useCheckbox(source === "widget" ? constraints : {});
        const toggle = useSwitch(source === "widget" ? constraints : {});
        const radio = useRadioGroup(source === "widget" ? constraints : {});
        const combo = useCombobox(source === "widget" ? constraints : {});
        const widget =
          kind === "checkbox"
            ? checkbox.control()
            : kind === "switch"
              ? toggle.control()
              : kind === "radio"
                ? radio.radio("a")
                : kind === "combobox"
                  ? combo.input()
                  : undefined;
        const hostConstraints = source === "host" ? constraints : {};
        return (
          <>
            <label mix={field.label()}>Value</label>
            <input
              {...hostConstraints}
              mix={
                widget === undefined
                  ? field.control()
                  : source === "widget"
                    ? [widget, field.control()]
                    : [field.control(), widget]
              }
            />
            {kind === "combobox" ? <div mix={combo.popup()} /> : null}
          </>
        );
      }
      const container = await render(<ComposedField />);
      const input = required(container, "input") as HTMLInputElement;
      const hasConstraint = source !== "widget" || kind !== "native";
      expect(input.disabled).toBe(hasConstraint);
      // Combobox does not have a required option; native/Field own validity.
      expect(input.required).toBe(
        hasConstraint && !(source === "widget" && kind === "combobox"),
      );
      await act(() => setConstrained(false));
      expect(input.disabled).toBe(false);
      expect(input.required).toBe(false);
    },
  );
}
