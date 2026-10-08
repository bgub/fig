// @vitest-environment happy-dom
import {
  type FigNode,
  type MixinDescriptor,
  readPromise,
  Suspense,
  transition,
  useState,
} from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { expect, it } from "vitest";
import { useDialog } from "../dialog/dialog.tsx";
import { useSelect } from "../select/select.tsx";
import { useTabs } from "../tabs/tabs.tsx";
import { useListbox } from "../listbox/listbox.tsx";
import { useMenu } from "../menu/menu.tsx";
import { useMenuSubmenu } from "../menu/submenu.ts";

it("controlled listbox requests use committed selection while an owner update suspends", async () => {
  const pending = new Promise<void>(() => {});
  const changes: string[][] = [];
  let update = () => {};
  function Child({ values }: { values: string[] }): FigNode {
    const list = useListbox({
      value: values,
      multiple: true,
      onValueChange: (value) => changes.push([...value]),
    });
    if (values.includes("b")) readPromise(pending);
    return (
      <div aria-label="Choices" mix={list.root()}>
        <div data-a="" mix={list.option("a")}>
          A
        </div>
        <div data-b="" mix={list.option("b")}>
          B
        </div>
      </div>
    );
  }
  function App(): FigNode {
    const [values, setValues] = useState(["a"]);
    update = () => transition(() => setValues(["a", "b"]));
    return (
      <Suspense fallback="Loading">
        <Child values={values} />
      </Suspense>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<App />));
    await act(update);
    expect(host.querySelector("[data-b]")?.getAttribute("aria-selected")).toBe(
      "false",
    );
    await act(() => host.querySelector<HTMLElement>("[data-b]")!.click());
    expect(changes).toEqual([["a", "b"]]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("retains authored native disabled on a submenu trigger", async () => {
  function App(): FigNode {
    const parent = useMenu();
    const child = useMenuSubmenu(parent, "more");
    return (
      <>
        <button mix={parent.trigger()}>Actions</button>
        <div mix={parent.menu()}>
          <button disabled data-sub="" mix={child.trigger()}>
            More
          </button>
          <div mix={child.menu()}>
            <button mix={child.item("copy")}>Copy</button>
          </div>
        </div>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<App />));
    expect(host.querySelector<HTMLButtonElement>("[data-sub]")!.disabled).toBe(
      true,
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("reconciles a label id changed by a descendant without ending the host lifetime", async () => {
  let rename = () => {};
  function Title({ part }: { part: MixinDescriptor }): FigNode {
    const [id, setId] = useState("initial-title");
    rename = () => setId("renamed-title");
    return (
      <h2 id={id} mix={part}>
        Preferences
      </h2>
    );
  }
  function App(): FigNode {
    const dialog = useDialog();
    return (
      <dialog mix={dialog.dialog()}>
        <Title part={dialog.title()} />
      </dialog>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<App />));
    const title = host.querySelector("h2")!;
    expect(host.querySelector("dialog")!.getAttribute("aria-labelledby")).toBe(
      "initial-title",
    );
    await act(rename);
    expect(host.querySelector("h2")).toBe(title);
    expect(host.querySelector("dialog")!.getAttribute("aria-labelledby")).toBe(
      "renamed-title",
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("composes tab selections in one batch, including a return to the committed value", async () => {
  const changes: string[] = [];
  function App(): FigNode {
    const tabs = useTabs({
      defaultValue: "a",
      onValueChange: (next) => {
        if (next !== null) changes.push(next);
      },
    });
    return (
      <div aria-label="Views" mix={tabs.list()}>
        <button mix={tabs.tab("a")}>A</button>
        <button mix={tabs.tab("b")}>B</button>
      </div>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<App />));
    const buttons = host.querySelectorAll("button");
    await act(() => {
      buttons[1]!.click();
      buttons[0]!.click();
    });
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("true");
    expect(changes).toEqual(["b", "a"]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("does not retry a canceled automatic Select repair in a reconciliation loop", async () => {
  let changes = 0;
  function App(): FigNode {
    const select = useSelect({
      onValueChange: (_, details) => {
        changes++;
        if (changes > 3)
          throw new Error("Automatic repair retried without a new input");
        details.cancel();
      },
    });
    return (
      <>
        <button mix={select.trigger()}>Choose</button>
        <div mix={select.popup()}>
          <div mix={select.option("a")}>A</div>
        </div>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<App />));
    // The initial before-paint pass is strict-run twice in development.
    expect(changes).toBe(2);
    expect(
      host.querySelector('[role="option"]')!.getAttribute("aria-selected"),
    ).toBe("false");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
