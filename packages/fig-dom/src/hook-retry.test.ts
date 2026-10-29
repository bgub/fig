import {
  createElement,
  readPromise,
  Suspense,
  type StateSetter,
  useId,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { afterEach, expect, it } from "vitest";
import { createRoot, flushSync, type FigRoot } from "./index.ts";
import {
  deferred,
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();
const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
});

it("continues a partially mounted hook sequence after suspension", async () => {
  const gate = deferred<string>();
  let setFirst: StateSetter<number> = () => {};
  let setLast: StateSetter<number> = () => {};
  function App() {
    const [first, updateFirst] = useState(1);
    setFirst = updateFirst;
    const label = useMemo(() => "value", []);
    readPromise(gate.promise);
    const [last, updateLast] = useState(10);
    setLast = updateLast;
    const id = useId();
    return createElement("span", { id }, `${label}:${first}:${last}`);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() =>
    root.render(
      createElement(
        Suspense,
        {
          fallback: createElement("i", null, "waiting"),
        },
        createElement(App),
      ),
    ),
  );
  expect(container.textContent).toBe("waiting");
  gate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("value:1:10");
  const element = container.childNodes[0] as FakeElement;
  const id = element.getAttribute("id");
  flushSync(() => {
    setFirst((value) => value + 1);
    setLast((value) => value + 2);
  });
  expect(container.textContent).toBe("value:2:12");
  expect(container.childNodes[0]).toBe(element);
  expect(element.getAttribute("id")).toBe(id);
});

it("preserves state queues around value hooks when an update suspends mid-sequence", async () => {
  const gate = deferred<string>();
  let setFirst: StateSetter<number> = () => {};
  let setLast: StateSetter<number> = () => {};
  let readCommitted = () => "";
  function App() {
    const [first, updateFirst] = useState(1);
    setFirst = updateFirst;
    const doubled = useMemo(() => first * 2, [first]);
    if (first > 1) readPromise(gate.promise);
    const [last, updateLast] = useState(10);
    setLast = updateLast;
    readCommitted = useStableEvent(() => `${doubled}:${last}`);
    return createElement("span", null, `${doubled}:${last}`);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() =>
    root.render(
      createElement(
        Suspense,
        {
          fallback: createElement("i", null, "waiting"),
        },
        createElement(App),
      ),
    ),
  );
  const savedRead = readCommitted;
  flushSync(() => {
    setFirst((value) => value + 1);
    setLast((value) => value + 2);
  });
  expect(container.textContent).toBe("2:10waiting");
  gate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("4:12");
  expect(readCommitted).toBe(savedRead);
  expect(savedRead()).toBe("4:12");
});
