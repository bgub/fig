import {
  createElement,
  readPromise,
  Suspense,
  transition,
  useState,
  useTransition,
} from "@bgub/fig";
import { expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import {
  deferred,
  waitForHostTurns,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";
installFakeDocument();

for (const mode of [
  "sequential",
  "same-turn",
  "ordinary",
  "separate-root",
  "hook",
] as const) {
  it(`commits a ready sibling while another transition suspends (${mode})`, async () => {
    const gate = deferred<string>();
    let slow!: () => void;
    let fast!: () => void;
    function Slow() {
      const [value, set] = useState<Promise<string> | null>(null);
      const [pending, start] = useTransition();
      slow = () =>
        mode === "hook"
          ? start(() => {
              set(gate.promise);
            })
          : transition(() => set(gate.promise));
      return createElement(
        "section",
        null,
        `${pending}:`,
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Message, { value }),
        ),
      );
    }
    function Message({ value }: { value: Promise<string> | null }) {
      return value === null ? "old" : readPromise(value);
    }
    function Fast() {
      const [value, set] = useState(0);
      const [pending, start] = useTransition();
      fast = () =>
        mode === "ordinary"
          ? set(1)
          : mode === "hook"
            ? start(() => {
                set(1);
              })
            : transition(() => set(1));
      return createElement("aside", null, `${pending}:${value}`);
    }
    const container = new FakeElement("root");
    const other = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const root2 =
      mode === "separate-root" ? createRoot(other as unknown as Element) : null;
    flushSync(() => {
      root.render(
        createElement(
          "main",
          null,
          createElement(Slow, null),
          root2 ? null : createElement(Fast, null),
        ),
      );
      root2?.render(createElement(Fast, null));
    });
    slow();
    if (mode !== "same-turn") await waitForHostTurns();
    fast();
    await waitForHostTurns();
    const before = container.textContent + other.textContent;
    expect(before).toBe(
      mode === "hook" ? "true:oldfalse:1" : "false:oldfalse:1",
    );
    gate.resolve("new");
    await waitForHostTurns();
    expect(container.textContent + other.textContent).toBe("false:newfalse:1");
    root.unmount();
    root2?.unmount();
  });
}
it("one transition keeps its own related updates atomic", async () => {
  const gate = deferred<string>();
  let update!: () => void;
  function App() {
    const [value, setValue] = useState<Promise<string> | null>(null);
    const [count, setCount] = useState(0);
    update = () =>
      transition(() => {
        setValue(gate.promise);
        setCount(1);
      });
    return createElement(
      "main",
      null,
      createElement(
        Suspense,
        { fallback: "loading" },
        createElement(Message, { value }),
      ),
      String(count),
    );
  }
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  update();
  await waitForHostTurns();
  expect(container.textContent).toBe("old0");
  gate.resolve("new");
  await waitForHostTurns();
  expect(container.textContent).toBe("new1");
  root.unmount();
});
it("a newer transition replaces a suspended value in the same state queue", async () => {
  const gate = deferred<string>();
  let set!: (v: Promise<string> | string) => void;
  function App() {
    const [value, update] = useState<Promise<string> | string>("ready");
    set = update;
    return createElement(
      Suspense,
      { fallback: "loading" },
      createElement(Message, { value }),
    );
  }
  function Message({ value }: { value: Promise<string> | string }) {
    return typeof value === "string" ? value : readPromise(value);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  transition(() => set(gate.promise));
  await waitForHostTurns();
  transition(() => set("replacement"));
  await waitForHostTurns();
  expect(container.textContent).toBe("replacement");
  gate.resolve("stale");
  await waitForHostTurns();
  expect(container.textContent).toBe("replacement");
  root.unmount();
});

it("coordinates transitions that share a state queue without exposing half of either update", async () => {
  const gate = deferred<string>();
  let first!: () => void;
  let second!: () => void;
  function App() {
    const [value, setValue] = useState<Promise<string> | null>(null);
    const [count, setCount] = useState(0);
    const [label, setLabel] = useState("old");
    first = () =>
      transition(() => {
        setValue(gate.promise);
        setCount(1);
      });
    second = () =>
      transition(() => {
        setCount(2);
        setLabel("new");
      });
    return createElement(
      "main",
      null,
      createElement(
        Suspense,
        { fallback: "loading" },
        createElement(Message, { value }),
      ),
      `:${count}:${label}`,
    );
  }
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  first();
  await waitForHostTurns();
  second();
  await waitForHostTurns();
  expect(container.textContent).toBe("old:0:old");
  gate.resolve("new");
  await waitForHostTurns();
  expect(container.textContent).toBe("new:2:new");
  root.unmount();
});

it("does not couple a completed queue to another transition when its old lane is reused", async () => {
  const gate = deferred<string>();
  let setSlow!: (value: Promise<string> | null) => void;
  let setFast!: (value: number) => void;
  function App() {
    const [slow, updateSlow] = useState<Promise<string> | null>(null);
    const [fast, updateFast] = useState(0);
    setSlow = updateSlow;
    setFast = updateFast;
    return createElement(
      "main",
      null,
      createElement(
        Suspense,
        { fallback: "loading" },
        createElement(Message, { value: slow }),
      ),
      String(fast),
    );
  }
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  transition(() => setFast(1));
  await waitForHostTurns();
  // Ten ordinary transition lanes are allocated round-robin. The slow update
  // now takes the exact lane just completed by the fast queue.
  for (let index = 0; index < 9; index += 1) transition(() => undefined);
  transition(() => setSlow(gate.promise));
  await waitForHostTurns();
  transition(() => setFast(2));
  await waitForHostTurns();
  expect(container.textContent).toBe("old2");
  gate.resolve("new");
  await waitForHostTurns();
  expect(container.textContent).toBe("new2");
  root.unmount();
});
