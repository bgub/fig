// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  Checkbox,
  type CheckboxCheckedChangeHandler,
  useCheckbox,
} from "./checkbox.tsx";

import { useSwitch } from "../switch/switch.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Checkbox", () => {
  it("drives a native checkbox and its state hooks", async () => {
    const container = await render(<Example defaultChecked={true} />);
    const input = inputOf(container);

    expect(input.type).toBe("checkbox");
    expect(input.checked).toBe(true);
    expect(input.hasAttribute("data-checked")).toBe(true);
    expect(input.hasAttribute("role")).toBe(false);
  });

  it("reports the toggle the platform made", async () => {
    const changes: Array<{ checked: boolean; event: string | null }> = [];
    const container = await render(
      <Example
        onCheckedChange={(checked, details) =>
          changes.push({ checked, event: details.event?.type ?? null })
        }
      />,
    );
    const input = inputOf(container);

    await toggle(input, true);

    expect(input.checked).toBe(true);
    expect(changes).toEqual([{ checked: true, event: "change" }]);
  });

  it("writes indeterminate, which has no attribute", async () => {
    const container = await render(<Example indeterminate={true} />);
    const input = inputOf(container);

    // The platform exposes it as a property only, so this is the widget's
    // work rather than something the caller can author in markup.
    expect(input.indeterminate).toBe(true);
    expect(input.hasAttribute("data-indeterminate")).toBe(true);
  });

  it("submits its value and honors required", async () => {
    const container = await render(
      <form data-form="">
        <Example defaultChecked={true} name="terms" value="accepted" />
      </form>,
    );
    const form = container.querySelector("form") as HTMLFormElement;

    expect(new FormData(form).get("terms")).toBe("accepted");
    expect(inputOf(container).required).toBe(false);
  });

  it("lets a controlled owner refuse a toggle", async () => {
    const container = await render(
      <Checkbox checked={false} onCheckedChange={(_c, d) => d.cancel()}>
        {(checkbox) => <input data-input="" mix={checkbox.control()} />}
      </Checkbox>,
    );
    const input = inputOf(container);

    await toggle(input, true);

    expect(input.checked).toBe(false);
  });

  it("toggles without an activation event", async () => {
    let parts: ReturnType<typeof useCheckbox> | undefined;
    function Programmatic(): FigNode {
      const checkbox = useCheckbox();
      parts = checkbox;
      return <input data-input="" mix={checkbox.control()} />;
    }

    const container = await render(<Programmatic />);

    await act(() => parts?.setChecked(true));

    expect(inputOf(container).checked).toBe(true);
  });

  it("lets a controlled owner retry an ignored imperative change", async () => {
    let changes = 0;
    let parts: ReturnType<typeof useCheckbox> | undefined;
    function Controlled(): FigNode {
      const checkbox = useCheckbox({
        checked: false,
        onCheckedChange: () => (changes += 1),
      });
      parts = checkbox;
      return <input data-input="" mix={checkbox.control()} />;
    }
    const container = await render(<Controlled />);

    await act(() => parts?.setChecked(true));
    await act(() => parts?.setChecked(true));

    expect(changes).toBe(2);
    expect(inputOf(container).checked).toBe(false);
  });

  it("returns uncontrolled state to its native form default", async () => {
    const container = await render(
      <form data-form="">
        <Example defaultChecked={true} />
      </form>,
    );
    const input = inputOf(container);
    await toggle(input, false);
    expect(input.checked).toBe(false);

    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).reset();
      await Promise.resolve();
    });

    expect(input.checked).toBe(true);
  });

  it("keeps a read-only checkbox focusable, submitted, and unchanged", async () => {
    const changes: boolean[] = [];
    const container = await render(
      <form data-form="">
        <Checkbox
          defaultChecked={true}
          name="terms"
          onCheckedChange={(checked) => changes.push(checked)}
          readOnly={true}
          value="accepted"
        >
          {(checkbox) => <input data-input="" mix={checkbox.control()} />}
        </Checkbox>
      </form>,
    );
    const input = inputOf(container);

    await toggle(input, false);

    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-readonly")).toBe("true");
    expect(input.tabIndex).toBe(0);
    expect(
      new FormData(container.querySelector("form") as HTMLFormElement).get(
        "terms",
      ),
    ).toBe("accepted");
    expect(changes).toEqual([]);
  });
});

function Example(props: {
  defaultChecked?: boolean;
  indeterminate?: boolean;
  name?: string;
  onCheckedChange?: CheckboxCheckedChangeHandler;
  readOnly?: boolean;
  value?: string;
}): FigNode {
  const checkbox = useCheckbox(props);
  return <input data-input="" mix={checkbox.control()} />;
}

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}

function inputOf(container: Element): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("[data-input]");
  if (input === null) throw new Error("Expected an input.");
  return input;
}

/** What the browser does when the box is clicked: tick it, then report. */
async function toggle(input: HTMLInputElement, checked: boolean) {
  await act(() => {
    input.checked = checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it.each(["checkbox", "switch"])(
  "reasserts an unchanged %s default after native reset",
  async (kind) => {
    function App(): FigNode {
      const control =
        kind === "checkbox"
          ? useCheckbox({ defaultChecked: true })
          : useSwitch({ defaultChecked: true });
      return (
        <form>
          <input
            data-input=""
            name="enabled"
            value="yes"
            mix={control.control()}
          />
        </form>
      );
    }
    const container = await render(<App />);
    await act(async () => {
      container.querySelector("form")!.reset();
      await Promise.resolve();
    });
    expect(inputOf(container).checked).toBe(true);
    expect(new FormData(container.querySelector("form")!).get("enabled")).toBe(
      "yes",
    );
  },
);

it("does not optimistically deduplicate controlled requests within one batch", async () => {
  let parts: ReturnType<typeof useCheckbox> | undefined;
  const changes: boolean[] = [];
  function App(): FigNode {
    const checkbox = useCheckbox({
      checked: false,
      onCheckedChange: (value) => changes.push(value),
    });
    parts = checkbox;
    return <input data-input="" mix={checkbox.control()} />;
  }
  const container = await render(<App />);
  await act(() => {
    parts?.setChecked(true);
    parts?.setChecked(true);
  });
  expect(changes).toEqual([true, true]);
  expect(inputOf(container).checked).toBe(false);
});

it("restores a change vetoed by an earlier native handler", async () => {
  const changes: boolean[] = [];
  const container = await render(
    <Checkbox onCheckedChange={(value) => changes.push(value)}>
      {(checkbox) => (
        <input
          data-input=""
          mix={[
            on("change", (event) => event.preventDefault()),
            checkbox.control(),
          ]}
        />
      )}
    </Checkbox>,
  );
  await act(() => {
    const input = inputOf(container);
    input.checked = true;
    input.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: true }),
    );
  });
  expect(changes).toEqual([]);
  expect(inputOf(container).checked).toBe(false);
});

it("reports repeated controlled native requests before the owner commits", async () => {
  const changes: boolean[] = [];
  const container = await render(
    <Checkbox checked={false} onCheckedChange={(value) => changes.push(value)}>
      {(checkbox) => <input data-input="" mix={checkbox.control()} />}
    </Checkbox>,
  );
  await act(() => {
    const input = inputOf(container);
    for (let index = 0; index < 2; index++) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  expect(changes).toEqual([true, true]);
  expect(inputOf(container).checked).toBe(false);
});

it.each(["checkbox", "switch"])(
  "refuses a change report from a disabled %s",
  async (kind) => {
    const changes: boolean[] = [];
    function App(): FigNode {
      const options = {
        disabled: true,
        onCheckedChange: (value: boolean) => changes.push(value),
      };
      const control =
        kind === "checkbox" ? useCheckbox(options) : useSwitch(options);
      return <input data-input="" mix={control.control()} />;
    }
    const container = await render(<App />);
    await toggle(inputOf(container), true);
    expect(changes).toEqual([]);
    expect(inputOf(container).checked).toBe(false);
  },
);
