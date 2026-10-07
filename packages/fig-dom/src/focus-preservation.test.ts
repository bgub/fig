// @vitest-environment happy-dom
import { createElement } from "@bgub/fig";
import { afterEach, expect, it, vi } from "vitest";
import { createPortal, createRoot, flushSync, type FigRoot } from "./index.ts";
import { preserveFocus } from "./focus.ts";
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

it("leaves focus policy to the commit wrapper during placement", () => {
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

it("leaves selection policy to the commit wrapper during placement", () => {
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
  selection.setBaseAndExtent(editable.firstChild!, 2, editable.firstChild!, 8);
  const insert = parent.insertBefore.bind(parent);
  vi.spyOn(parent, "insertBefore").mockImplementation((node, before) => {
    const result = insert(node, before);
    editable.focus();
    selection.removeAllRanges();
    return result;
  });
  insertDomNode(parent, editable, null);
  expect(document.activeElement).toBe(editable);
  expect(selection.rangeCount).toBe(0);
});

it("uses ordinary insertion between separate detached trees", () => {
  const source = document.createElement("div");
  const parent = document.createElement("div");
  const child = document.createElement("input");
  source.append(child);
  const move = vi.fn();
  Object.defineProperty(parent, "moveBefore", { value: move });
  insertDomNode(parent, child, null);
  expect(child.parentNode).toBe(parent);
  expect(move).not.toHaveBeenCalled();
});

it("restores focus on a failed mutation without leaking its snapshot to the next commit", () => {
  const parent = document.createElement("div");
  const first = document.createElement("input");
  const second = document.createElement("input");
  parent.append(first, second);
  document.body.append(parent);
  first.focus();
  expect(() =>
    preserveFocus(parent, () => {
      first.remove();
      parent.append(first);
      second.focus();
      throw new Error("mutation failed");
    }),
  ).toThrow("mutation failed");
  expect(document.activeElement).toBe(first);
  second.focus();
  preserveFocus(parent, () => {
    second.remove();
    parent.append(second);
  });
  expect(document.activeElement).toBe(second);
});

it("preserves same-document portal focus when the root is in an unfocused closed shadow tree", () => {
  const host = document.createElement("div");
  const target = document.createElement("div");
  document.body.append(host, target);
  const root = createRoot(host.attachShadow({ mode: "closed" }));
  roots.push(root);
  const render = (keys: string[]) =>
    root.render(
      createPortal(
        createElement(
          "div",
          null,
          keys.map((key) =>
            createElement("input", {
              key,
              id: key,
              defaultValue: "Selected text",
            }),
          ),
        ),
        target,
      ),
    );
  flushSync(() => render(["moved", "other"]));
  const input = target.querySelector<HTMLInputElement>("#moved")!;
  input.focus();
  input.setSelectionRange(2, 8, "backward");
  flushSync(() => render(["other", "moved"]));
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([2, 8, "backward"]);
});
