// @vitest-environment happy-dom
import { type FigNode, useState } from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { usePopupPosition } from "./position.ts";

let root: FigRoot | undefined;
afterEach(async () => {
  if (root !== undefined) await act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("observes only while open, releases listeners on close, and restores styles on unmount", async () => {
  const observers: Array<{
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor() {
        observers.push(this);
      }
    },
  );
  let setOpen = (_open: boolean) => {};
  function Example(): FigNode {
    const [open, update] = useState(false);
    setOpen = update;
    const position = usePopupPosition({ open });
    return (
      <>
        <button mix={position.anchor()}>Anchor</button>
        <div
          style={{
            position: "absolute",
            top: "17px",
            marginRight: "9px",
            maxHeight: "50px",
            overflow: "hidden",
          }}
          mix={position.popup()}
        >
          Popup
        </div>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root?.render(<Example />));
  const popup = host.querySelector("div")!;
  expect(observers).toHaveLength(0);
  await act(() => setOpen(true));
  expect(observers.length).toBeGreaterThan(0);
  expect(observers.at(-1)?.observe).toHaveBeenCalledWith(popup);
  await act(() => setOpen(false));
  expect(
    observers.every((observer) => observer.disconnect.mock.calls.length === 1),
  ).toBe(true);
  popup.style.left = "42px";
  document.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("resize"));
  expect(popup.style.left).toBe("42px");
  await act(() => root?.unmount());
  root = undefined;
  expect(popup.style.position).toBe("absolute");
  expect(popup.style.top).toBe("17px");
  expect(popup.style.marginRight).toBe("9px");
  expect(popup.style.maxHeight).toBe("50px");
  expect(popup.style.overflow).toBe("hidden");
  // Preserve an author edit made after the helper stopped positioning.
  expect(popup.style.left).toBe("42px");
});

it("releases replaced popup hosts and observes their replacements", async () => {
  const observed: Element[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(node: Element) {
        observed.push(node);
      }
      disconnect = disconnect;
    },
  );
  let replace = () => {};
  function Example(): FigNode {
    const [version, update] = useState(0);
    replace = () => update((v) => v + 1);
    const position = usePopupPosition({ open: true });
    return (
      <>
        <button mix={position.anchor()}>Anchor</button>
        <div key={version} mix={position.popup()}>
          Popup
        </div>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root?.render(<Example />));
  const old = host.querySelector("div")!;
  const before = disconnect.mock.calls.length;
  await act(replace);
  const current = host.querySelector("div")!;
  expect(current).not.toBe(old);
  expect(old.style.position).toBe("");
  expect(current.style.position).toBe("fixed");
  expect(observed).toContain(current);
  expect(disconnect.mock.calls.length).toBeGreaterThan(before);
});

it("cancels queued measurements, animation tracking, and intersection observers on close", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const resizeCallbacks: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const intersections: Array<{
    callback: (
      entries: Array<{
        intersectionRect: { width: number; height: number };
        intersectionRatio: number;
      }>,
    ) => void;
    disconnected: boolean;
  }> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      disconnected = false;
      constructor(
        readonly callback: (typeof intersections)[number]["callback"],
      ) {
        intersections.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  );
  let setOpen = (_open: boolean) => {};
  function Example() {
    const [open, update] = useState(true);
    setOpen = update;
    const position = usePopupPosition({ open, trackAnchorAnimation: true });
    return (
      <>
        <button mix={position.anchor()}>Anchor</button>
        <div mix={position.popup()}>Popup</div>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root?.render(<Example />));
  expect(frames.size).toBeGreaterThan(0);
  resizeCallbacks.at(-1)!();
  const pending = [...frames.values()];
  await act(() => setOpen(false));
  expect(frames.size).toBe(0);
  expect(intersections.every((observer) => observer.disconnected)).toBe(true);
  const popup = host.querySelector("div")!;
  popup.style.left = "42px";
  popup.removeAttribute("data-anchor-hidden");
  for (const callback of pending) callback(0);
  for (const observer of intersections)
    observer.callback([
      { intersectionRect: { width: 0, height: 0 }, intersectionRatio: 0 },
    ]);
  for (const callback of resizeCallbacks) callback();
  expect(popup.style.left).toBe("42px");
  expect(popup.hasAttribute("data-anchor-hidden")).toBe(false);
  expect(frames.size).toBe(0);
});
