// @vitest-environment happy-dom
import { createElement } from "@bgub/fig";
import { afterEach, expect, it, vi } from "vitest";
import { createRoot, flushSync, type FigRoot } from "./index.ts";
import { insertDomNode } from "./placement.ts";

const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("uses an atomic native move for an already mounted node", () => {
  const parent = document.createElement("div");
  const first = document.createElement("button");
  const second = document.createElement("button");
  parent.append(first, second);
  document.body.append(parent);
  const move = vi.fn();
  Object.defineProperty(parent, "moveBefore", { value: move });
  const insert = vi.spyOn(parent, "insertBefore");
  insertDomNode(parent, first, null);
  expect(move).toHaveBeenCalledWith(first, null);
  expect(insert).not.toHaveBeenCalled();
});

it("uses ordinary insertion for a new disconnected node", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const move = vi.fn();
  Object.defineProperty(parent, "moveBefore", { value: move });
  const child = document.createElement("button");
  insertDomNode(parent, child, null);
  expect(child.parentNode).toBe(parent);
  expect(move).not.toHaveBeenCalled();
});

it("uses ordinary insertion when a mounted node crosses documents", () => {
  const source = document.implementation.createHTMLDocument();
  const child = source.createElement("button");
  source.body.append(child);
  const parent = document.createElement("div");
  document.body.append(parent);
  const move = vi.fn();
  Object.defineProperty(parent, "moveBefore", { value: move });
  insertDomNode(parent, child, null);
  expect(child.ownerDocument).toBe(document);
  expect(child.parentNode).toBe(parent);
  expect(move).not.toHaveBeenCalled();
});

it("does not restore focus when a move disconnects the focused subtree", () => {
  const child = document.createElement("button");
  document.body.append(child);
  child.focus();
  const parent = document.createElement("div");
  const move = vi.fn();
  Object.defineProperty(parent, "moveBefore", { value: move });
  insertDomNode(parent, child, null);
  expect(document.activeElement).toBe(document.body);
  expect(move).not.toHaveBeenCalled();
});

it("does not steal focus selected during a fallback insertion", () => {
  const parent = document.createElement("div");
  const moved = document.createElement("button");
  const other = document.createElement("button");
  parent.append(moved, other);
  document.body.append(parent);
  Object.defineProperty(parent, "moveBefore", { value: undefined });
  moved.focus();
  const insert = parent.insertBefore.bind(parent);
  vi.spyOn(parent, "insertBefore").mockImplementation((node, before) => {
    const result = insert(node, before);
    other.focus();
    return result;
  });
  insertDomNode(parent, moved, null);
  expect(document.activeElement).toBe(other);
});

it("leaves an already positioned focused node attached", () => {
  const parent = document.createElement("div");
  const child = document.createElement("button");
  parent.append(child);
  document.body.append(parent);
  child.focus();
  const insert = vi.spyOn(parent, "insertBefore");
  insertDomNode(parent, child, null);
  expect(insert).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(child);
});

it("keeps focus when reconciliation moves the focused keyed host", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const list = (values: string[]) =>
    createElement(
      "div",
      null,
      values.map((value) =>
        createElement("button", { key: value, id: value }, value),
      ),
    );
  flushSync(() => root.render(list(["b", "a"])));
  const focused = container.querySelector<HTMLButtonElement>("#b")!;
  focused.focus();
  flushSync(() => root.render(list(["a", "b"])));
  expect(container.querySelector("#b")).toBe(focused);
  expect(document.activeElement).toBe(focused);
});

it("keeps focus in a descendant when its keyed ancestor moves", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const list = (values: string[]) =>
    createElement(
      "div",
      null,
      values.map((value) =>
        createElement(
          "section",
          { key: value },
          createElement("input", { id: value, defaultValue: "Selection" }),
        ),
      ),
    );
  flushSync(() => root.render(list(["b", "a"])));
  const focused = container.querySelector<HTMLInputElement>("#b")!;
  focused.focus();
  focused.setSelectionRange(2, 5);
  flushSync(() => root.render(list(["a", "b"])));
  expect(document.activeElement).toBe(focused);
  expect([focused.selectionStart, focused.selectionEnd]).toEqual([2, 5]);
});

it.each([
  [2, 8],
  [8, 2],
])(
  "preserves a contenteditable selection from %i to %i during a fallback move",
  (anchorOffset, focusOffset) => {
    const parent = document.createElement("div");
    Object.defineProperty(parent, "moveBefore", { value: undefined });
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    editable.textContent = "Selected text";
    parent.append(editable, document.createElement("span"));
    document.body.append(parent);
    editable.focus();
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(
      editable.firstChild!,
      anchorOffset,
      editable.firstChild!,
      focusOffset,
    );
    // Browsers reset this selection during detachment; happy-dom does not.
    const insert = parent.insertBefore.bind(parent);
    vi.spyOn(parent, "insertBefore").mockImplementation((node, before) => {
      const result = insert(node, before);
      selection.removeAllRanges();
      return result;
    });
    insertDomNode(parent, editable, null);
    expect(document.activeElement).toBe(editable);
    expect(selection.toString()).toBe("lected");
    expect(selection.anchorNode).toBe(editable.firstChild);
    expect(selection.anchorOffset).toBe(anchorOffset);
    expect(selection.focusOffset).toBe(focusOffset);
  },
);
