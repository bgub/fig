// @vitest-environment happy-dom
import type { FigNode } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { Switch, useSwitch } from "./switch.tsx";

const roots: FigRoot[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("Switch", () => {
  it("is a native checkbox announced as a switch", async () => {
    const changes: boolean[] = [];
    const container = await render(
      <Switch
        defaultChecked={true}
        name="notifications"
        onCheckedChange={(checked) => changes.push(checked)}
      >
        {(control) => <input data-input="" mix={control.control()} />}
      </Switch>,
    );
    const input = container.querySelector<HTMLInputElement>("[data-input]");

    expect(input?.type).toBe("checkbox");
    expect(input?.getAttribute("role")).toBe("switch");
    expect(input?.checked).toBe(true);
    expect(input?.name).toBe("notifications");

    await act(() => {
      if (input === null) return;
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(changes).toEqual([false]);
    expect(input?.checked).toBe(false);
  });

  it("works from the hook without a wrapper", async () => {
    function Toggle(): FigNode {
      const control = useSwitch({ defaultChecked: false });
      return <input data-input="" mix={control.control()} />;
    }

    const container = await render(<Toggle />);

    expect(
      container
        .querySelector<HTMLInputElement>("[data-input]")
        ?.getAttribute("role"),
    ).toBe("switch");
  });

  it("supports read-only state without disabling the switch", async () => {
    const container = await render(
      <Switch defaultChecked={true} readOnly={true}>
        {(control) => <input data-input="" mix={control.control()} />}
      </Switch>,
    );
    const input = container.querySelector<HTMLInputElement>("[data-input]");

    expect(input?.disabled).toBe(false);
    expect(input?.getAttribute("aria-readonly")).toBe("true");
    expect(input?.getAttribute("data-readonly")).toBe("");
  });
});

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}
