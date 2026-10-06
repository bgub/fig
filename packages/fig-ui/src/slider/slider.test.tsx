// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  Slider,
  type SliderOptions,
  type SliderParts,
  useSlider,
} from "./slider.tsx";

const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function render(node: FigNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return { container, root, input: container.querySelector("input")! };
}
function Example(options: SliderOptions): FigNode {
  const slider = useSlider(options);
  return (
    <form>
      <label>
        Volume
        <input mix={slider.control()} />
      </label>
      <output>{slider.value}</output>
    </form>
  );
}
async function native(input: HTMLInputElement, value: number, type = "input") {
  await act(() => {
    input.value = String(value);
    input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });
}

it.each([
  [{}, 50],
  [{ min: 10, max: 20 }, 15],
  [{ defaultValue: -5 }, 0],
  [{ defaultValue: 120 }, 100],
  [{ min: 10, max: 5, defaultValue: 8 }, 10],
  [{ max: 10, step: 3, defaultValue: 10 }, 9],
  [{ min: 0.1, max: 1, step: 0.1, defaultValue: 0.25 }, 0.3],
  [{ max: 0.3, step: 0.1, defaultValue: 0.3 }, 0.3],
  [{ max: 1, step: "any", defaultValue: 0.345 }, 0.345],
  [{ step: -1, defaultValue: 12.4 }, 12],
  [{ step: 0, defaultValue: 12.5 }, 13],
  [{ min: NaN, max: Infinity, defaultValue: NaN }, 50],
] satisfies Array<[SliderOptions, number]>)(
  "normalizes native range options %j",
  async (options, expected) => {
    const { input, container } = await render(<Example {...options} />);
    expect(input.type).toBe("range");
    expect(input.valueAsNumber).toBe(expected);
    expect(container.querySelector("output")?.textContent).toBe(
      String(expected),
    );
  },
);

it("distinguishes continuous input from a committed change", async () => {
  const changed: number[] = [];
  const committed: number[] = [];
  const { input, container } = await render(
    <Example
      name="volume"
      defaultValue={10}
      onValueChange={(v) => changed.push(v)}
      onValueCommit={(v) => committed.push(v)}
    />,
  );
  await native(input, 20);
  await native(input, 30);
  expect(committed).toEqual([]);
  await native(input, 30, "change");
  expect(changed).toEqual([20, 30]);
  expect(committed).toEqual([30]);
  expect(new FormData(container.querySelector("form")!).get("volume")).toBe(
    "30",
  );
  await native(input, 30, "change");
  expect(committed).toEqual([30]);
});

it("accepts change without a preceding input", async () => {
  const calls: string[] = [];
  const { input } = await render(
    <Example
      onValueChange={(v) => calls.push(`input:${v}`)}
      onValueCommit={(v) => calls.push(`commit:${v}`)}
    />,
  );
  await native(input, 60, "change");
  expect(calls).toEqual(["input:60", "commit:60"]);
});

it("restores canceled changes and does not commit them", async () => {
  const commits: number[] = [];
  const { input } = await render(
    <Example
      defaultValue={10}
      onValueChange={(_, d) => d.cancel()}
      onValueCommit={(v) => commits.push(v)}
    />,
  );
  await native(input, 20);
  expect(input.valueAsNumber).toBe(10);
  await native(input, 20, "change");
  expect(input.valueAsNumber).toBe(10);
  expect(commits).toEqual([]);
});

it("honors caller event cancellation", async () => {
  const calls: number[] = [];
  const { input } = await render(
    <Slider
      defaultValue={10}
      onValueChange={(v) => calls.push(v)}
      onValueCommit={(v) => calls.push(v)}
    >
      {(s) => (
        <input
          aria-label="Volume"
          mix={[
            on("input", (e) => e.preventDefault()),
            on("change", (e) => e.preventDefault()),
            s.control(),
          ]}
        />
      )}
    </Slider>,
  );
  await native(input, 20);
  await native(input, 20, "change");
  expect(input.valueAsNumber).toBe(10);
  expect(calls).toEqual([]);
});

it("restores controlled values and permits repeated requests", async () => {
  const changed: number[] = [];
  const committed: number[] = [];
  const { input } = await render(
    <Example
      value={10}
      onValueChange={(v) => changed.push(v)}
      onValueCommit={(v) => committed.push(v)}
    />,
  );
  await native(input, 20);
  await native(input, 20);
  expect(input.valueAsNumber).toBe(10);
  expect(changed).toEqual([20, 20]);
  await native(input, 10, "change");
  expect(committed).toEqual([]);
});

it.each([false, true])(
  "restores %s controlled state on form reset without callbacks",
  async (controlled) => {
    const changes: number[] = [];
    const { input, container } = await render(
      <Example
        {...(controlled ? { value: 20 } : { defaultValue: 20 })}
        onValueChange={(v) => changes.push(v)}
      />,
    );
    await native(input, 40);
    changes.length = 0;
    await act(async () => {
      container.querySelector("form")!.reset();
      await Promise.resolve();
    });
    expect(input.valueAsNumber).toBe(20);
    expect(changes).toEqual([]);
  },
);

it("respects prevented form resets", async () => {
  const { input, container } = await render(<Example defaultValue={20} />);
  await native(input, 40);
  container
    .querySelector("form")!
    .addEventListener("reset", (e) => e.preventDefault());
  await act(async () => {
    // happy-dom resets controls even when its reset event is prevented.
    container
      .querySelector("form")!
      .dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  expect(input.valueAsNumber).toBe(40);
});

it.each(["options", "host"])(
  "preserves read-only behavior from %s",
  async (source) => {
    const changed: number[] = [];
    const { input, container } = await render(
      <form>
        <Slider
          defaultValue={20}
          name="seek"
          readOnly={source === "options"}
          onValueChange={(v) => changed.push(v)}
        >
          {(s) => (
            <input
              aria-label="Volume"
              readonly={source === "host"}
              mix={s.control()}
            />
          )}
        </Slider>
      </form>,
    );
    const key = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      input.dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(true);
    await native(input, 40);
    expect(input.valueAsNumber).toBe(20);
    expect(changed).toEqual([]);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-readonly")).toBe("true");
    expect(new FormData(container.querySelector("form")!).get("seek")).toBe(
      "20",
    );
  },
);

it("preserves authored disabled and name props", async () => {
  const changed: number[] = [];
  const { input } = await render(
    <Slider
      defaultValue={20}
      name="fallback"
      onValueChange={(v) => changed.push(v)}
    >
      {(s) => (
        <input
          aria-label="Volume"
          disabled={true}
          name="explicit"
          mix={s.control()}
        />
      )}
    </Slider>,
  );
  expect(input.disabled).toBe(true);
  expect(input.name).toBe("explicit");
  await native(input, 40);
  expect(input.valueAsNumber).toBe(20);
  expect(changed).toEqual([]);
});

it("normalizes programmatic requests and keeps commit for user interaction", async () => {
  let parts: SliderParts | undefined;
  const changes: Array<number | string> = [];
  function App(): FigNode {
    const slider = useSlider({
      defaultValue: 0,
      max: 10,
      step: 3,
      onValueChange: (v, d) => changes.push(d.event === null ? v : "event"),
      onValueCommit: () => changes.push("commit"),
    });
    parts = slider;
    return <input aria-label="Volume" mix={slider.control()} />;
  }
  const { input } = await render(<App />);
  await act(() => parts?.setValue(10));
  expect(input.valueAsNumber).toBe(9);
  expect(changes).toEqual([9]);
});

it("reclamps changing constraints and resets against current constraints", async () => {
  const { root, input, container } = await render(
    <Example defaultValue={80} />,
  );
  await act(() => root.render(<Example defaultValue={10} max={40} />));
  expect(input.valueAsNumber).toBe(40);
  await native(input, 20);
  await act(async () => {
    // happy-dom resets controls even when its reset event is prevented.
    container
      .querySelector("form")!
      .dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  expect(input.valueAsNumber).toBe(40);
});

it("does not move already aligned large values by a step", async () => {
  const { input } = await render(
    <Example
      min={0}
      max={1e16}
      step={1}
      defaultValue={4_503_599_627_370_495}
    />,
  );
  expect(input.valueAsNumber).toBe(4_503_599_627_370_495);
});

it("commits accepted controlled input once after owner updates", async () => {
  let set: ((value: number) => void) | undefined;
  const committed: number[] = [];
  function App(): FigNode {
    const [value, setValue] = useState(10);
    set = setValue;
    const slider = useSlider({
      value,
      onValueChange: setValue,
      onValueCommit: (next) => committed.push(next),
    });
    return <input aria-label="Volume" mix={slider.control()} />;
  }
  const { input } = await render(<App />);
  await native(input, 20);
  expect(input.valueAsNumber).toBe(20);
  await native(input, 20, "change");
  expect(committed).toEqual([20]);
  await act(() => set?.(30));
  await native(input, 30, "change");
  expect(committed).toEqual([20]);
});

it("aborts callback work on superseding changes and unmount", async () => {
  const changes: AbortSignal[] = [];
  const commits: AbortSignal[] = [];
  const { input, root } = await render(
    <Example
      onValueChange={(_v, _d, s) => changes.push(s)}
      onValueCommit={(_v, _d, s) => commits.push(s)}
    />,
  );
  await native(input, 60);
  expect(changes[0]?.aborted).toBe(false);
  await native(input, 60, "change");
  await native(input, 70);
  expect(changes[0]?.aborted).toBe(true);
  expect(changes[1]?.aborted).toBe(false);
  await native(input, 70, "change");
  expect(commits[0]?.aborted).toBe(true);
  await act(() => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  expect(changes[1]?.aborted).toBe(true);
  expect(commits[1]?.aborted).toBe(true);
});

it("allows focus navigation keys in a read-only slider", async () => {
  const { input } = await render(<Example readOnly={true} />);
  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  await act(() => {
    input.dispatchEvent(tab);
  });
  expect(tab.defaultPrevented).toBe(false);
});

it("reports an unlabeled native slider in development", async () => {
  const errors: unknown[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  roots.push(root);
  await act(() =>
    root.render(
      <Slider>{(slider) => <input mix={slider.control()} />}</Slider>,
    ),
  );
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(Error);
  expect((errors[0] as Error).message).toContain("requires an accessible name");
});

it("commits controlled input when input and change arrive in one batch", async () => {
  const changes: number[] = [];
  const commits: number[] = [];
  function App(): FigNode {
    const [value, setValue] = useState(10);
    const slider = useSlider({
      value,
      onValueChange: (next) => {
        changes.push(next);
        setValue(next);
      },
      onValueCommit: (next) => commits.push(next),
    });
    return <input aria-label="Volume" mix={slider.control()} />;
  }
  const { input } = await render(<App />);
  await act(() => {
    input.value = "20";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(input.valueAsNumber).toBe(20);
  expect(changes).toEqual([20]);
  expect(commits).toEqual([20]);
});

it("retains an accepted interaction after a canceled imperative request", async () => {
  let parts: SliderParts | undefined;
  const commits: number[] = [];
  function App(): FigNode {
    const slider = useSlider({
      defaultValue: 10,
      onValueChange: (next, details) => {
        if (next === 30) details.cancel();
      },
      onValueCommit: (next) => commits.push(next),
    });
    parts = slider;
    return <input aria-label="Volume" mix={slider.control()} />;
  }
  const { input } = await render(<App />);
  await native(input, 20);
  await act(() => parts?.setValue(30));
  await native(input, 20, "change");
  expect(commits).toEqual([20]);
});

it("ignores input inside a disabled fieldset", async () => {
  const changes: number[] = [];
  const { input } = await render(
    <fieldset disabled={true}>
      <Example defaultValue={20} onValueChange={(next) => changes.push(next)} />
    </fieldset>,
  );
  expect(input.disabled).toBe(false);
  // happy-dom does not implement inherited fieldset disability.
  const matches = input.matches.bind(input);
  vi.spyOn(input, "matches").mockImplementation(
    (selector) => selector === ":disabled" || matches(selector),
  );
  await native(input, 40, "change");
  expect(changes).toEqual([]);
  expect(input.valueAsNumber).toBe(20);
});

it("honors the native first-legend exception to disabled fieldsets", async () => {
  const changes: number[] = [];
  const { input } = await render(
    <fieldset disabled={true}>
      <legend>
        <Example
          defaultValue={20}
          onValueChange={(next) => changes.push(next)}
        />
      </legend>
    </fieldset>,
  );
  expect(input.matches(":disabled")).toBe(false);
  await native(input, 40, "change");
  expect(changes).toEqual([40]);
});

it("preserves an accepted drag when setValue requests the current value", async () => {
  let parts: SliderParts | undefined;
  const commits: number[] = [];
  function App(): FigNode {
    const slider = useSlider({
      defaultValue: 10,
      onValueCommit: (next) => commits.push(next),
    });
    parts = slider;
    return <input aria-label="Volume" mix={slider.control()} />;
  }
  const { input } = await render(<App />);
  await native(input, 20);
  await act(() => parts?.setValue(20));
  await native(input, 20, "change");
  expect(commits).toEqual([20]);
});

it("handles finite extreme bounds without overflowing step arithmetic", async () => {
  const { input, container } = await render(
    <Example min={-1e308} max={1e308} step={1e308} defaultValue={5e307} />,
  );
  expect(input.valueAsNumber).toBe(1e308);
  expect(container.querySelector("output")?.textContent).toBe("1e+308");
});
