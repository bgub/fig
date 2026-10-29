// @vitest-environment happy-dom
import {
  Activity,
  createElement as h,
  Fragment,
  ErrorBoundary,
  readPromise,
  Suspense,
  useBeforePaint,
  useState,
} from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "./act.ts";
import {
  createPortal,
  createRoot,
  hydrateRoot,
  type FragmentInstance,
} from "./index.ts";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  root.unmount();
  container.remove();
});

function observer() {
  return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
}

describe("Fragment DOM binds", () => {
  it("binds after placement, focuses descendants, and exposes only first-level rectangles", async () => {
    let group: FragmentInstance | undefined;
    let ready = false;
    function Fields() {
      useBeforePaint(() => {
        expect(group).toBeDefined();
      }, []);
      return h(
        "section",
        null,
        h("input", { id: "first" }),
        h("input", { id: "last" }),
      );
    }
    await act(() =>
      root.render(
        h(
          Fragment,
          {
            bind(instance: FragmentInstance) {
              group = instance;
              ready = container.querySelectorAll("input").length === 2;
            },
          },
          h(Fields, null),
          h("p", null, "description"),
        ),
      ),
    );
    expect(ready).toBe(true);
    expect(container.children).toHaveLength(2);
    group!.focus();
    expect(document.activeElement?.id).toBe("first");
    group!.focusLast();
    expect(document.activeElement?.id).toBe("last");
    group!.blur();
    expect(document.activeElement).toBe(document.body);
    const rect = new DOMRect(10, 20, 30, 40);
    vi.spyOn(container.children[0], "getClientRects").mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    expect(group!.getClientRects()).toEqual([
      rect,
      ...container.children[1].getClientRects(),
    ]);
  });

  it("keeps handles and subscriptions through child updates and keyed moves", async () => {
    const watched = observer();
    const click = vi.fn();
    const signals: AbortSignal[] = [];
    const handles: FragmentInstance[] = [];
    const bind = (group: FragmentInstance, signal: AbortSignal): undefined => {
      handles.push(group);
      signals.push(signal);
      group.observeUsing(watched);
      group.addEventListener("click", click);
    };
    let change!: (value: boolean) => void;
    function Child() {
      const [expanded, set] = useState(false);
      change = set;
      return expanded
        ? h("button", { id: "new" }, "new")
        : h("input", { id: "old" });
    }
    const group = () => h(Fragment, { key: "group", bind }, h(Child, null));
    await act(() => root.render([group(), h("p", { key: "other" }, "other")]));
    const calls = handles.length;
    const old = container.querySelector("input")!;
    await act(() => change(true));
    const button = container.querySelector("button")!;
    expect(watched.unobserve).toHaveBeenCalledWith(old);
    expect(watched.observe).toHaveBeenCalledWith(button);
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
    old.dispatchEvent(new Event("click", { bubbles: true }));
    expect(click).toHaveBeenCalledTimes(1);
    await act(() => root.render([h("p", { key: "other" }, "other"), group()]));
    expect(container.lastElementChild).toBe(button);
    expect(handles).toHaveLength(calls);
    expect(new Set(handles).size).toBe(1);
    expect(signals.at(-1)?.aborted).toBe(false);
    await act(() => root.render(null));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(handles[0].getClientRects()).toEqual([]);
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("aborts on callback changes and Activity hide, then rebinds the same handle on reveal", async () => {
    const observed = observer();
    const handles: FragmentInstance[] = [];
    const signals: AbortSignal[] = [];
    const bind = (group: FragmentInstance, signal: AbortSignal): undefined => {
      handles.push(group);
      signals.push(signal);
      group.observeUsing(observed);
    };
    const render = (mode: "visible" | "hidden", callback = bind) =>
      root.render(
        h(
          Activity,
          { mode },
          h(Fragment, { bind: callback }, h("input", null)),
        ),
      );
    await act(() => render("hidden"));
    expect(handles).toHaveLength(0);
    await act(() => render("visible"));
    expect(handles).toHaveLength(2); // Development run/abort/run.
    expect(signals[0].aborted).toBe(true);
    await act(() => render("hidden"));
    expect(signals.at(-1)?.aborted).toBe(true);
    const count = handles.length;
    await act(() => render("visible"));
    expect(handles).toHaveLength(count + 1);
    expect(new Set(handles).size).toBe(1);
    const previous = signals.at(-1)!;
    await act(() => render("visible", (group, signal) => bind(group, signal)));
    expect(previous.aborted).toBe(true);
    expect(signals.at(-1)?.aborted).toBe(false);
  });

  it("excludes portals and hidden descendants, and tracks empty groups", async () => {
    const portal = document.createElement("div");
    document.body.append(portal);
    const watched = observer();
    const bind = (group: FragmentInstance): undefined => {
      group.observeUsing(watched);
    };
    const view = (mode: "visible" | "hidden") =>
      h(
        Fragment,
        { bind },
        "text",
        h(Activity, { mode }, h("button", null, "inside")),
        createPortal(h("button", null, "portal"), portal),
      );
    try {
      await act(() => root.render(view("hidden")));
      expect(watched.observe).not.toHaveBeenCalled();
      await act(() => root.render(view("visible")));
      expect(watched.observe).toHaveBeenCalledExactlyOnceWith(
        container.querySelector("button"),
      );
      await act(() => root.render(view("hidden")));
      expect(watched.unobserve).toHaveBeenCalledWith(
        container.querySelector("button"),
      );
      expect(portal.textContent).toBe("portal");
    } finally {
      root.unmount();
      portal.remove();
    }
  });

  it("does not publish suspended work and updates membership when Suspense reveals", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    function Child() {
      readPromise(pending);
      return h("input", { id: "ready" });
    }
    const watched = observer();
    const bind = (group: FragmentInstance): undefined => {
      group.observeUsing(watched);
    };
    await act(() =>
      root.render(
        h(
          Fragment,
          { bind },
          h(Suspense, { fallback: h("p", null, "pending") }, h(Child, null)),
        ),
      ),
    );
    expect(watched.observe).toHaveBeenCalledWith(container.querySelector("p"));
    expect(container.querySelector("input")).toBeNull();
    await act(async () => {
      resolve();
      await pending;
    });
    expect(watched.observe).toHaveBeenCalledWith(
      container.querySelector("input"),
    );
    expect(container.querySelector("p")).toBeNull();
  });

  it("never binds an uncommitted suspended group", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    function Child() {
      readPromise(pending);
      return h("input", null);
    }
    const bind = vi.fn((): undefined => undefined);
    await act(() =>
      root.render(
        h(
          Suspense,
          { fallback: "pending" },
          h(Fragment, { bind }, h(Child, null)),
        ),
      ),
    );
    expect(bind).not.toHaveBeenCalled();
    await act(() => root.render(null));
    await act(async () => {
      resolve();
      await pending;
    });
    expect(bind).not.toHaveBeenCalled();
  });

  it("reports bind failures through the root and releases group subscriptions", async () => {
    root.unmount();
    const onUncaughtError = vi.fn();
    root = createRoot(container, { onUncaughtError });
    const watched = observer();
    let group!: FragmentInstance;
    let signal!: AbortSignal;
    await act(() =>
      root.render(
        h(
          ErrorBoundary,
          { fallback: "failed" },
          h(
            "div",
            null,
            h(
              Fragment,
              {
                bind(instance: FragmentInstance, lifetime: AbortSignal) {
                  group = instance;
                  signal = lifetime;
                  instance.observeUsing(watched);
                  throw new Error("bind failed");
                },
              },
              h("input", null),
            ),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("");
    expect(onUncaughtError).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
    expect(watched.unobserve).toHaveBeenCalled();
    expect(group.getClientRects()).toEqual([]);
  });

  it("normalizes listener capture and does not revive aborted registrations on new children", async () => {
    let group!: FragmentInstance;
    const bind = (instance: FragmentInstance): undefined => {
      group = instance;
    };
    const view = (key: string) =>
      h(Fragment, { bind }, h("button", { key }, key));
    await act(() => root.render(view("one")));
    const callback = vi.fn();
    group.addEventListener("click", callback, true);
    group.removeEventListener("click", callback, { capture: true });
    container.querySelector("button")!.click();
    expect(callback).not.toHaveBeenCalled();
    const controller = new AbortController();
    group.addEventListener("click", callback, { signal: controller.signal });
    controller.abort();
    await act(() => root.render(view("two")));
    container.querySelector("button")!.click();
    expect(callback).not.toHaveBeenCalled();
  });

  it("ignores binds during HTML rendering and attaches to hydrated nodes", async () => {
    const watched = observer();
    const bind = vi.fn((group: FragmentInstance): undefined => {
      group.observeUsing(watched);
    });
    const view = h(
      Fragment,
      { bind },
      h("input", null),
      h("button", null, "send"),
    );
    const html = await renderToHtml(view);
    expect(bind).not.toHaveBeenCalled();
    root.unmount();
    container.innerHTML = html;
    const input = container.firstElementChild;
    root = hydrateRoot(container, view);
    await act(() => undefined);
    expect(container.firstElementChild).toBe(input);
    expect(watched.observe).toHaveBeenCalledWith(input);
  });
});
