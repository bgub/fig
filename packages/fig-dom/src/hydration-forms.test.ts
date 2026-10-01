// @vitest-environment happy-dom
import {
  createElement,
  readPromise,
  Suspense,
  useBeforePaint,
  useState,
} from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { describe, expect, it, vi } from "vitest";
import { act } from "./act.ts";
import { adoptFormState, flushSync, hydrateRoot, on } from "./index.ts";

describe("hydration form adoption", () => {
  it("adopts a pre-hydration edit before an effect-triggered sync render", () => {
    const container = document.createElement("div");
    container.innerHTML = '<input value="Server">';
    const input = container.firstElementChild as HTMLInputElement;
    input.value = "User typed";
    let observed = "";
    let notifications = 0;
    function App() {
      const [value, setValue] = useState("Server");
      const [tick, setTick] = useState(0);
      observed = value;
      useBeforePaint(() => {
        flushSync(() => setTick(1));
      }, []);
      return createElement("input", {
        value,
        "data-tick": tick,
        mix: adoptFormState((node) => {
          notifications++;
          setValue((node as HTMLInputElement).value);
        }),
      });
    }
    const root = flushSync(() =>
      hydrateRoot(container, createElement(App, null)),
    );
    expect(input.value).toBe("User typed");
    expect(observed).toBe("User typed");
    expect(notifications).toBe(1);
    expect(input.dataset.tick).toBe("1");
    flushSync(() => root.unmount());
  });
});

interface ControlCase {
  name: string;
  html: string;
  tag: string;
  initial: string | boolean | string[];
  edited: string | boolean | string[];
  props?: Record<string, unknown>;
  children?: ReturnType<typeof createElement>[];
}

const options = () => [
  createElement("option", { value: "a" }, "A"),
  createElement("option", { value: "b" }, "B"),
  createElement("option", { value: "c" }, "C"),
];

const controls: ControlCase[] = [
  {
    name: "input",
    html: '<input value="Server">',
    tag: "input",
    initial: "Server",
    edited: "User typed",
  },
  {
    name: "textarea",
    html: "<textarea>Server</textarea>",
    tag: "textarea",
    initial: "Server",
    edited: "User typed",
  },
  {
    name: "checkbox",
    html: '<input type="checkbox">',
    tag: "input",
    initial: false,
    edited: true,
    props: { type: "checkbox" },
  },
  {
    name: "single select",
    html: '<select><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select>',
    tag: "select",
    initial: "a",
    edited: "b",
    children: options(),
  },
  {
    name: "multiple select",
    html: '<select multiple><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select>',
    tag: "select",
    initial: ["a"],
    edited: ["b", "c"],
    props: { multiple: true },
    children: options(),
  },
];

function liveValue(
  element: Element,
  scenario: ControlCase,
): ControlCase["initial"] {
  if (typeof scenario.initial === "boolean")
    return (element as HTMLInputElement).checked;
  if (Array.isArray(scenario.initial))
    return Array.from(
      (element as HTMLSelectElement).selectedOptions,
      (option) => option.value,
    );
  return (element as HTMLInputElement).value;
}

function edit(element: Element, scenario: ControlCase): void {
  if (typeof scenario.edited === "boolean")
    (element as HTMLInputElement).checked = scenario.edited;
  else if (Array.isArray(scenario.edited)) {
    for (const option of (element as HTMLSelectElement).options)
      option.selected = scenario.edited.includes(option.value);
  } else (element as HTMLInputElement).value = scenario.edited;
}

describe.each(controls)("$name hydration", (scenario) => {
  it.each([false, true])(
    "respects field ownership without an adopter (uncontrolled=%s)",
    (uncontrolled) => {
      const container = document.createElement("div");
      container.innerHTML = scenario.html;
      const element = container.firstElementChild as Element;
      edit(element, scenario);
      const events = vi.fn();
      let state: ControlCase["initial"] = scenario.initial;
      let rerender: () => void = () => {};
      function App() {
        const [value] = useState(scenario.initial);
        const [tick, setTick] = useState(0);
        state = value;
        rerender = () => setTick((previous) => previous + 1);
        const prop =
          typeof value === "boolean"
            ? uncontrolled
              ? "defaultChecked"
              : "checked"
            : uncontrolled
              ? "defaultValue"
              : "value";
        return createElement(
          scenario.tag,
          {
            ...scenario.props,
            [prop]: value,
            "data-tick": tick,
            mix: [on("input", events), on("change", events)],
          },
          ...(scenario.children ?? []),
        );
      }
      const root = flushSync(() => hydrateRoot(container, createElement(App)));
      expect(state).toEqual(scenario.initial);
      expect(liveValue(element, scenario)).toEqual(
        uncontrolled ? scenario.edited : state,
      );
      expect(events).not.toHaveBeenCalled();
      flushSync(rerender);
      expect(liveValue(element, scenario)).toEqual(
        uncontrolled ? scenario.edited : state,
      );
      expect(element.getAttribute("data-tick")).toBe("1");
      expect(events).not.toHaveBeenCalled();
      flushSync(() => root.unmount());
    },
  );

  it.each([false, true])(
    "preserves and notifies with uncontrolled=%s",
    (uncontrolled) => {
      const container = document.createElement("div");
      container.innerHTML = scenario.html;
      const element = container.firstElementChild as Element;
      edit(element, scenario);
      const notifications: string[] = [];
      let state: ControlCase["initial"] = scenario.initial;
      function App() {
        const [value, setValue] = useState(scenario.initial);
        const [tick, setTick] = useState(0);
        state = value;
        useBeforePaint(() => {
          flushSync(() => setTick(1));
        }, []);
        const prop =
          typeof value === "boolean"
            ? uncontrolled
              ? "defaultChecked"
              : "checked"
            : uncontrolled
              ? "defaultValue"
              : "value";
        return createElement(
          scenario.tag,
          {
            ...scenario.props,
            [prop]: uncontrolled ? scenario.initial : value,
            "data-tick": tick,
            mix: [
              adoptFormState((node) => {
                notifications.push("adopt");
                if (!uncontrolled)
                  setValue(liveValue(node as Element, scenario));
              }),
              on("change", (event) => {
                notifications.push(event.type);
              }),
              on("click", () => {
                notifications.push("click");
              }),
            ],
          },
          ...(scenario.children ?? []),
        );
      }
      const root = flushSync(() =>
        hydrateRoot(container, createElement(App, null)),
      );
      expect(liveValue(element, scenario)).toEqual(scenario.edited);
      expect(state).toEqual(uncontrolled ? scenario.initial : scenario.edited);
      expect(notifications).toEqual(["adopt"]);
      expect(element.getAttribute("data-tick")).toBe("1");
      flushSync(() => root.unmount());
    },
  );

  it("does not notify unchanged fields", () => {
    const container = document.createElement("div");
    container.innerHTML = scenario.html;
    const notifications: string[] = [];
    const prop = typeof scenario.initial === "boolean" ? "checked" : "value";
    const root = flushSync(() =>
      hydrateRoot(
        container,
        createElement(
          scenario.tag,
          {
            ...scenario.props,
            [prop]: scenario.initial,
            mix: [
              adoptFormState(() => {
                notifications.push("adopt");
              }),
              on("change", () => {
                notifications.push("change");
              }),
            ],
          },
          ...(scenario.children ?? []),
        ),
      ),
    );
    expect(notifications).toEqual([]);
    flushSync(() => root.unmount());
  });
});

it("adopts a radio group using only the selected member's notifications", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<div><input type="radio" name="choice" value="a" checked><input type="radio" name="choice" value="b"></div>';
  document.body.append(container);
  const [a, b] = Array.from(container.querySelectorAll("input"));
  b!.checked = true;
  let selection = "a";
  const notified: string[] = [];
  function App() {
    const [value, setValue] = useState("a");
    selection = value;
    return createElement(
      "div",
      null,
      ...["a", "b"].map((choice) =>
        createElement("input", {
          type: "radio",
          name: "choice",
          value: choice,
          checked: value === choice,
          mix: adoptFormState((node) => {
            notified.push(choice);
            flushSync(() => setValue((node as HTMLInputElement).value));
          }),
        }),
      ),
    );
  }
  const root = flushSync(() =>
    hydrateRoot(container, createElement(App, null)),
  );
  expect(a!.checked).toBe(false);
  expect(b!.checked).toBe(true);
  expect(selection).toBe("b");
  expect(notified).toEqual(["b"]);
  flushSync(() => root.unmount());
  container.remove();
});

it("allows an adoption callback to flushSync without erasing other pending fields", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<div><input value="Server"><input value="Server"></div>';
  const [a, b] = Array.from(container.querySelectorAll("input"));
  a!.value = "First";
  b!.value = "Second";
  const adopted: string[] = [];
  function App() {
    const [values, setValues] = useState(["Server", "Server"]);
    return createElement(
      "div",
      null,
      ...values.map((value, index) =>
        createElement("input", {
          value,
          mix: adoptFormState((node) => {
            const live = (node as HTMLInputElement).value;
            adopted.push(live);
            flushSync(() =>
              setValues((previous) =>
                previous.map((entry, i) => (i === index ? live : entry)),
              ),
            );
          }),
        }),
      ),
    );
  }
  const root = flushSync(() =>
    hydrateRoot(container, createElement(App, null)),
  );
  expect(adopted).toEqual(["First", "Second"]);
  expect([a!.value, b!.value]).toEqual(["First", "Second"]);
  flushSync(() => root.unmount());
});

it("resumes controlled writes on subsequent renders", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  const input = container.firstElementChild as HTMLInputElement;
  input.value = "User typed";
  let reset: () => void = () => {};
  function App() {
    const [value, setValue] = useState("Server");
    reset = () => setValue("Server");
    return createElement("input", {
      value,
      mix: adoptFormState((node) => {
        setValue(node.value);
      }),
    });
  }
  const root = flushSync(() => hydrateRoot(container, createElement(App)));
  expect(input.value).toBe("User typed");
  flushSync(reset);
  expect(input.value).toBe("Server");
  flushSync(() => root.unmount());
});

it.each([false, true])(
  "respects radio checked ownership independently of its value (uncontrolled=%s)",
  (uncontrolled) => {
    const container = document.createElement("div");
    container.innerHTML =
      '<div><input type="radio" name="choice" value="a" checked><input type="radio" name="choice" value="b"></div>';
    document.body.append(container);
    const [a, b] = Array.from(container.querySelectorAll("input"));
    b!.checked = true;
    const tree = () =>
      createElement(
        "div",
        null,
        ...["a", "b"].map((value) =>
          createElement("input", {
            type: "radio",
            name: "choice",
            value,
            [uncontrolled ? "defaultChecked" : "checked"]: value === "a",
          }),
        ),
      );
    const root = flushSync(() => hydrateRoot(container, tree()));
    expect([a!.checked, b!.checked]).toEqual(
      uncontrolled ? [false, true] : [true, false],
    );
    flushSync(() => root.render(tree()));
    expect([a!.checked, b!.checked]).toEqual(
      uncontrolled ? [false, true] : [true, false],
    );
    flushSync(() => root.unmount());
    container.remove();
  },
);

it("does not duplicate an input event that forces shell hydration", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  const input = container.firstElementChild as HTMLInputElement;
  const events: string[] = [];
  let observed = "Server";
  function App() {
    const [value, setValue] = useState("Server");
    const [, setTick] = useState(0);
    observed = value;
    useBeforePaint(() => {
      flushSync(() => setTick(1));
    }, []);
    return createElement("input", {
      value,
      mix: adoptFormState((node) => {
        const live = (node as HTMLInputElement).value;
        events.push(live);
        setValue(live);
      }),
    });
  }
  const root = hydrateRoot(container, createElement(App, null));
  input.value = "User typed";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync(() => {});
  expect(events).toEqual(["User typed"]);
  expect(observed).toBe("User typed");
  expect(input.value).toBe("User typed");
  flushSync(() => root.unmount());
});

it("applies a value normalized by flushSync inside a hydration notification", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  const input = container.firstElementChild as HTMLInputElement;
  input.value = "user typed";
  function App() {
    const [value, setValue] = useState("Server");
    return createElement("input", {
      value,
      mix: adoptFormState((node) => {
        const live = (node as HTMLInputElement).value;
        flushSync(() => setValue(live.toUpperCase()));
      }),
    });
  }
  const root = flushSync(() =>
    hydrateRoot(container, createElement(App, null)),
  );
  expect(input.value).toBe("USER TYPED");
  flushSync(() => root.unmount());
});

it("adopts edits when a selectively hydrated Suspense boundary becomes ready", async () => {
  let gate: Promise<void> | null = null;
  let resolve!: () => void;
  let observed = "Server";
  let notifications = 0;
  function Field() {
    const [value, setValue] = useState("Server");
    const [, setTick] = useState(0);
    observed = value;
    if (gate !== null) readPromise(gate);
    useBeforePaint(() => {
      flushSync(() => setTick(1));
    }, []);
    return createElement("input", {
      value,
      mix: adoptFormState((node) => {
        notifications++;
        setValue((node as HTMLInputElement).value);
      }),
    });
  }
  function App() {
    return createElement(
      Suspense,
      { fallback: "Loading" },
      createElement(Field, null),
    );
  }
  const container = document.createElement("div");
  container.innerHTML = await renderToHtml(createElement(App, null));
  const input = container.querySelector("input")!;
  gate = new Promise<void>((done) => {
    resolve = done;
  });
  let root!: ReturnType<typeof hydrateRoot>;
  await act(() => {
    root = hydrateRoot(container, createElement(App, null));
  });
  input.value = "User typed";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(notifications).toBe(0);
  expect(container.querySelector("input")).toBe(input);
  await act(() => {
    resolve();
  });
  expect(notifications).toBe(1);
  expect(observed).toBe("User typed");
  expect(input.value).toBe("User typed");
  flushSync(() => root.unmount());
});

it("does not notify form edits from a failed hydration commit", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  const input = container.firstElementChild as HTMLInputElement;
  input.value = "User typed";
  const notifications: string[] = [];
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  expect(() =>
    flushSync(() => {
      root = hydrateRoot(
        container,
        createElement("input", {
          value: "Server",
          mix: adoptFormState(() => {
            notifications.push("adopt");
          }),
          bind: () => {
            throw new Error("Bind failed");
          },
        }),
        {
          onUncaughtError: (error) => {
            errors.push(error);
          },
        },
      );
    }),
  ).toThrow("Bind failed");
  expect(errors).toHaveLength(1);
  expect(notifications).toEqual([]);
  expect(container.childElementCount).toBe(0);
  flushSync(() => root.render(createElement("input", { value: "Recovered" })));
  expect(notifications).toEqual([]);
  expect((container.firstElementChild as HTMLInputElement).value).toBe(
    "Recovered",
  );
  flushSync(() => root.unmount());
});

it("does not infer edits from duplicate single-select values", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<select><option value="a" selected>A1</option><option value="a" selected>A2</option></select>';
  let notifications = 0;
  const root = flushSync(() =>
    hydrateRoot(
      container,
      createElement(
        "select",
        {
          value: "a",
          mix: adoptFormState(() => {
            notifications++;
          }),
        },
        createElement("option", { value: "a" }, "A1"),
        createElement("option", { value: "a" }, "A2"),
      ),
    ),
  );
  expect(notifications).toBe(0);
  flushSync(() => root.unmount());
});

it("reports adoption-callback errors without clearing the hydrated tree or losing other edits", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<div><input value="Server"><input value="Server"></div>';
  const [first, second] = Array.from(container.querySelectorAll("input"));
  first!.value = "First";
  second!.value = "Second";
  const error = new Error("Handler failed");
  const report = vi.fn();
  const rootErrors: unknown[] = [];
  let observed = "Server";
  function App() {
    const [value, setValue] = useState("Server");
    observed = value;
    return createElement(
      "div",
      null,
      createElement("input", {
        value: "Server",
        mix: adoptFormState(() => {
          throw error;
        }),
      }),
      createElement("input", {
        value,
        mix: adoptFormState((node) => {
          setValue((node as HTMLInputElement).value);
        }),
      }),
    );
  }
  vi.stubGlobal("reportError", report);
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    expect(() =>
      flushSync(() => {
        root = hydrateRoot(container, createElement(App, null), {
          onUncaughtError: (error) => {
            rootErrors.push(error);
          },
        });
      }),
    ).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    expect(rootErrors).toEqual([]);
    expect(container.contains(second!)).toBe(true);
    expect(second!.value).toBe("Second");
    expect(observed).toBe("Second");
  } finally {
    flushSync(() => root?.unmount());
    vi.unstubAllGlobals();
  }
});

it.each(controls)(
  "applies client state to an untouched $name without adoption",
  (scenario) => {
    const container = document.createElement("div");
    container.innerHTML = scenario.html;
    const field = container.firstElementChild!;
    const adopted = vi.fn();
    const prop = typeof scenario.initial === "boolean" ? "checked" : "value";
    const root = flushSync(() =>
      hydrateRoot(
        container,
        createElement(
          scenario.tag,
          {
            ...scenario.props,
            [prop]: scenario.edited,
            mix: adoptFormState(adopted),
          },
          ...(scenario.children ?? []),
        ),
      ),
    );
    expect(liveValue(field, scenario)).toEqual(scenario.edited);
    expect(adopted).not.toHaveBeenCalled();
    flushSync(() => root.unmount());
  },
);

it("uses textarea children as the SSR baseline without inventing edit events", () => {
  const container = document.createElement("div");
  container.innerHTML = "<textarea>Server</textarea>";
  const adopted = vi.fn();
  const input = vi.fn();
  const change = vi.fn();
  const root = flushSync(() =>
    hydrateRoot(
      container,
      createElement(
        "textarea",
        {
          mix: [
            adoptFormState(adopted),
            on("input", input),
            on("change", change),
          ],
        },
        "Server",
      ),
    ),
  );
  expect((container.firstElementChild as HTMLTextAreaElement).value).toBe(
    "Server",
  );
  expect(adopted).not.toHaveBeenCalled();
  expect(input).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
  flushSync(() => root.unmount());
});

it("preserves uncontrolled edits without invoking ordinary handlers", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  const input = container.firstElementChild as HTMLInputElement;
  input.value = "User typed";
  const events = vi.fn();
  const root = flushSync(() =>
    hydrateRoot(
      container,
      createElement("input", {
        defaultValue: "Server",
        mix: [on("input", events), on("change", events)],
      }),
    ),
  );
  expect(input.value).toBe("User typed");
  expect(events).not.toHaveBeenCalled();
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(events).toHaveBeenCalledTimes(1);
  flushSync(() => root.unmount());
});

it("delivers a hydration-triggering input normally alongside explicit adoption", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  const input = container.firstElementChild as HTMLInputElement;
  const adopted: string[] = [];
  const events: Event[] = [];
  function App() {
    const [value, setValue] = useState("Server");
    return createElement("input", {
      value,
      mix: [
        adoptFormState((node) => {
          adopted.push(node.value);
          setValue(node.value);
        }),
        on("input", (event) => {
          events.push(event);
          setValue((event.target as HTMLInputElement).value);
        }),
      ],
    });
  }
  const root = hydrateRoot(container, createElement(App));
  input.value = "User typed";
  const event = new Event("input", { bubbles: true });
  input.dispatchEvent(event);
  flushSync(() => {});
  expect(adopted).toEqual(["User typed"]);
  expect(events).toEqual([event]);
  expect(input.value).toBe("User typed");
  flushSync(() => root.unmount());
});

it("aborts adoption signals on callback replacement and removal without adopting again", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  (container.firstElementChild as HTMLInputElement).value = "Edited";
  const signals: AbortSignal[] = [];
  const callback = (
    _node: HTMLInputElement,
    signal: AbortSignal,
  ): undefined => {
    signals.push(signal);
  };
  const root = flushSync(() =>
    hydrateRoot(
      container,
      createElement("input", {
        mix: adoptFormState(callback),
      }),
    ),
  );
  expect(signals).toHaveLength(1);
  expect(signals[0]!.aborted).toBe(false);
  flushSync(() =>
    root.render(createElement("input", { mix: adoptFormState(callback) })),
  );
  expect(signals[0]!.aborted).toBe(false);
  flushSync(() =>
    root.render(createElement("input", { mix: adoptFormState(() => {}) })),
  );
  expect(signals[0]!.aborted).toBe(true);
  expect(signals).toHaveLength(1);
  flushSync(() => root.unmount());
});

it.each(["mixin", "node"])(
  "aborts adoption signals when the %s is removed",
  (mode) => {
    const container = document.createElement("div");
    container.innerHTML = '<input value="Server">';
    (container.firstElementChild as HTMLInputElement).value = "Edited";
    let signal: AbortSignal | undefined;
    const root = flushSync(() =>
      hydrateRoot(
        container,
        createElement("input", {
          mix: adoptFormState((_node, currentSignal) => {
            signal = currentSignal;
          }),
        }),
      ),
    );
    expect(signal?.aborted).toBe(false);
    if (mode === "mixin") flushSync(() => root.render(createElement("input")));
    else flushSync(() => root.unmount());
    expect(signal?.aborted).toBe(true);
    if (mode === "mixin") flushSync(() => root.unmount());
  },
);

it("continues other adopters when a callback throws", () => {
  const container = document.createElement("div");
  container.innerHTML = '<input value="Server">';
  (container.firstElementChild as HTMLInputElement).value = "Edited";
  const error = new Error("Adopter failed");
  const report = vi.fn();
  const next = vi.fn();
  vi.stubGlobal("reportError", report);
  try {
    const root = flushSync(() =>
      hydrateRoot(
        container,
        createElement("input", {
          mix: [
            adoptFormState(() => {
              throw error;
            }),
            adoptFormState(next),
          ],
        }),
      ),
    );
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    expect(next).toHaveBeenCalledTimes(1);
    flushSync(() => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

it("rejects adoption on a non-form host", () => {
  expect(() => createElement("div", { mix: adoptFormState(() => {}) })).toThrow(
    "adoptFormState() requires an input, textarea, or select.",
  );
});
