// @vitest-environment happy-dom
import { type FigNode } from "@bgub/fig";
import { createRoot, type FigRoot, on } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, expect, it } from "vitest";
import { type CommandOptions, useCommand } from "./command.tsx";

const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
});

const items = [
  { value: "copy", label: "Copy", group: "Edit", keywords: ["duplicate"] },
  { value: "paste", label: "Paste", group: "Edit", disabled: true },
  { value: "save", label: "Save", group: "File" },
];

function Example(props: Partial<CommandOptions<string>> = {}): FigNode {
  const command = useCommand({ items, ...props });
  return (
    <>
      <input aria-label="Commands" mix={command.input()} />
      <div mix={command.list()}>
        {["Edit", "File"].map((group) => (
          <div data-group={group} mix={command.group(group)}>
            {command.items
              .filter((item) => item.group === group)
              .map((item) => (
                <button key={item.value} mix={command.item(item)}>
                  {item.label}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div mix={command.emptyMessage()}>No results</div>
    </>
  );
}

it("filters labels and keywords, hides empty groups, and announces no results", async () => {
  const container = await render(<Example />);
  const input = get<HTMLInputElement>(container, "input");
  await type(input, "DUPLICATE");
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(get(container, '[data-group="Edit"]').hidden).toBe(false);
  expect(get(container, '[data-group="Edit"]').getAttribute("aria-label")).toBe(
    "Edit",
  );
  expect(get(container, '[data-group="File"]').hidden).toBe(true);
  expect(get(container, '[role="status"]').hidden).toBe(true);
  await type(input, "unknown");
  expect(get(container, '[role="status"]').hidden).toBe(false);
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
});

it("repeated keyboard actions preserve query and input focus", async () => {
  const actions: string[] = [];
  const edits: string[] = [];
  const container = await render(
    <Example
      onAction={(item) => actions.push(item.value)}
      onInputValueChange={(value) => edits.push(value)}
    />,
  );
  const input = get<HTMLInputElement>(container, "input");
  input.focus();
  await type(input, "dup");
  await key(input, "Enter");
  await key(input, "Enter");
  expect(actions).toEqual(["copy", "copy"]);
  expect(edits).toEqual(["dup"]);
  expect(input.value).toBe("dup");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(input);
  expect(get(container, '[role="listbox"]').hidden).toBe(false);
});

it("skips disabled commands and supports pointer actions without form submission", async () => {
  const actions: string[] = [];
  const container = await render(
    <form>
      <Example onAction={(item) => actions.push(item.value)} />
    </form>,
  );
  const input = get<HTMLInputElement>(container, "input");
  await key(input, "ArrowDown");
  await key(input, "Enter");
  expect(actions).toEqual(["save"]);
  const copy = get<HTMLButtonElement>(container, '[role="option"]');
  expect(copy.type).toBe("button");
  await act(() => copy.click());
  expect(actions).toEqual(["save", "copy"]);
  const disabled = get<HTMLButtonElement>(container, '[aria-disabled="true"]');
  await act(() => disabled.click());
  expect(actions).toEqual(["save", "copy"]);
});

it("honors controlled and canceled query edits", async () => {
  const changes: string[] = [];
  const container = await render(
    <Example
      inputValue="copy"
      onInputValueChange={(next) => changes.push(next)}
    />,
  );
  const input = get<HTMLInputElement>(container, "input");
  await type(input, "save");
  expect(changes).toEqual(["save"]);
  expect(input.value).toBe("copy");
  await act(() =>
    roots
      .at(-1)
      ?.render(
        <Example onInputValueChange={(_next, details) => details.cancel()} />,
      ),
  );
  await type(input, "save");
  expect(input.value).toBe("");
});

it("accepts external filtering and custom predicates", async () => {
  const container = await render(
    <Example filter={false} defaultInputValue="unmatched" />,
  );
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
  await act(() =>
    roots.at(-1)?.render(<Example filter={(item) => item.value === "save"} />),
  );
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(get(container, '[role="option"]').textContent).toBe("Save");
});

it("preserves keyboard highlight across replacement item data with the same identity", async () => {
  const actions: string[] = [];
  const container = await render(<Example />);
  const input = get<HTMLInputElement>(container, "input");
  await key(input, "ArrowDown");
  await act(() =>
    roots
      .at(-1)
      ?.render(
        <Example
          items={items.map((item) => ({ ...item }))}
          onAction={(item) => actions.push(item.value)}
        />,
      ),
  );
  await key(input, "Enter");
  expect(actions).toEqual(["save"]);
});

it("honors canceled command keys and IME confirmation", async () => {
  const actions: string[] = [];
  function Canceled(): FigNode {
    const command = useCommand({
      items,
      onAction: (item) => actions.push(item.value),
    });
    return (
      <>
        <input
          aria-label="Commands"
          mix={[
            on("keydown", (event) => event.preventDefault()),
            command.input(),
          ]}
        />
        <div mix={command.list()}>
          {command.items.map((item) => (
            <div mix={command.item(item)}>{item.label}</div>
          ))}
        </div>
      </>
    );
  }
  const container = await render(<Canceled />);
  const input = get<HTMLInputElement>(container, "input");
  await key(input, "Enter");
  expect(actions).toEqual([]);
  await act(() =>
    roots
      .at(-1)
      ?.render(<Example onAction={(item) => actions.push(item.value)} />),
  );
  await act(() =>
    get(container, "input").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    ),
  );
  expect(actions).toEqual([]);
});

async function render(node: FigNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(node));
  return container;
}
function get<T extends HTMLElement = HTMLElement>(
  container: Element,
  selector: string,
): T {
  const node = container.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
async function key(input: HTMLElement, key: string): Promise<void> {
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

it("repairs highlight when a command is disabled or removed", async () => {
  const actions: string[] = [];
  const onAction: CommandOptions<string>["onAction"] = (item) =>
    actions.push(item.value);
  const container = await render(<Example onAction={onAction} />);
  const input = get<HTMLInputElement>(container, "input");
  await act(() =>
    roots.at(-1)?.render(
      <Example
        items={items.map((item) => ({
          ...item,
          disabled: item.value !== "save",
        }))}
        onAction={onAction}
      />,
    ),
  );
  await key(input, "Enter");
  expect(actions).toEqual(["save"]);
  await act(() =>
    roots.at(-1)?.render(<Example items={[items[0]]} onAction={onAction} />),
  );
  await key(input, "Enter");
  expect(actions).toEqual(["save", "copy"]);
  await act(() =>
    roots.at(-1)?.render(<Example items={[]} onAction={onAction} />),
  );
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  await key(input, "Enter");
  expect(actions).toEqual(["save", "copy"]);
});

it("rejects duplicate command values through the shared option diagnostics", async () => {
  const errors: unknown[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  roots.push(root);
  await act(() =>
    root.render(
      <Example items={[items[0], { ...items[0], label: "Duplicate" }]} />,
    ),
  );
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toMatch(/command item values must be unique/);
});

it("does not repeat filtering for highlight-only renders", async () => {
  let calls = 0;
  const filter = () => {
    calls += 1;
    return true;
  };
  const container = await render(<Example filter={filter} />);
  const input = get<HTMLInputElement>(container, "input");
  const initialCalls = calls;
  expect(initialCalls).toBeGreaterThan(0);
  await key(input, "ArrowDown");
  await key(input, "ArrowUp");
  expect(calls).toBe(initialCalls);
  await type(input, "query");
  expect(calls).toBe(initialCalls * 2);
});

it.each([false, true])(
  "resets %s controlled query without edit or action callbacks",
  async (controlled) => {
    const callbacks: string[] = [];
    const container = await render(
      <form>
        <Example
          {...(controlled
            ? { inputValue: "copy" }
            : { defaultInputValue: "copy" })}
          onInputValueChange={(value) => callbacks.push(value)}
          onAction={(item) => callbacks.push(item.value)}
        />
      </form>,
    );
    const input = get<HTMLInputElement>(container, "input");
    await type(input, "save");
    callbacks.length = 0;
    await act(async () => {
      get<HTMLFormElement>(container, "form").reset();
      await Promise.resolve();
    });
    expect(input.value).toBe("copy");
    expect(callbacks).toEqual([]);
    expect(get(container, '[role="option"]').textContent).toBe("Copy");
  },
);

it("leaves Escape available to a containing dialog", async () => {
  const escaped: boolean[] = [];
  const container = await render(
    <div
      mix={on("keydown", (event) => {
        if (event.key === "Escape") escaped.push(event.defaultPrevented);
      })}
    >
      <Example />
    </div>,
  );
  const input = get<HTMLInputElement>(container, "input");
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  await act(() => input.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(escaped).toEqual([false]);
  expect(get(container, '[role="listbox"]').hidden).toBe(false);
});
