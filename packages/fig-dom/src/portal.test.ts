import { createContext, createElement, readContext } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createPortal, createRoot, flushSync, on } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

function portalTarget(target: FakeElement): Element {
  return target as unknown as Element;
}

describe("@bgub/fig-dom portals", () => {
  it("renders portal children into a target outside the parent DOM tree", () => {
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          "Shell",
          createPortal(
            createElement("aside", null, "Portal"),
            portalTarget(target),
          ),
        ),
      ),
    );

    expect(container.textContent).toBe("Shell");
    expect(target.textContent).toBe("Portal");
    expect(target.childNodes).toHaveLength(1);
  });

  it("updates portal children in place", () => {
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createPortal(
          createElement("span", null, "Before"),
          portalTarget(target),
        ),
      ),
    );

    const child = target.childNodes[0];

    flushSync(() =>
      root.render(
        createPortal(
          createElement("span", null, "After"),
          portalTarget(target),
        ),
      ),
    );

    expect(target.childNodes[0]).toBe(child);
    expect(target.textContent).toBe("After");
  });

  it("remounts portal children when the target changes", () => {
    const container = new FakeElement("root");
    const firstTarget = new FakeElement("first-portal-root");
    const secondTarget = new FakeElement("second-portal-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createPortal(
          createElement("span", null, "Portal"),
          portalTarget(firstTarget),
        ),
      ),
    );

    flushSync(() =>
      root.render(
        createPortal(
          createElement("span", null, "Portal"),
          portalTarget(secondTarget),
        ),
      ),
    );

    expect(firstTarget.textContent).toBe("");
    expect(secondTarget.textContent).toBe("Portal");
  });

  it("keeps context flowing through the logical tree", () => {
    const Theme = createContext("light");
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    const root = createRoot(container as unknown as Element);

    function Label() {
      return createElement("span", null, readContext(Theme));
    }

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "dark" },
          createPortal(createElement(Label, null), portalTarget(target)),
        ),
      ),
    );

    expect(target.textContent).toBe("dark");
  });

  it("bubbles delegated events through the logical tree", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          { events: [on("click", () => calls.push("parent"))] },
          createPortal(
            createElement("button", {
              events: [on("click", () => calls.push("button"))],
            }),
            portalTarget(target),
          ),
        ),
      ),
    );

    const button = target.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(calls).toEqual(["button", "parent"]);
  });

  it("does not dispatch portal events twice when the target is inside the root", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    container.appendChild(target);
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          { events: [on("click", () => calls.push("parent"))] },
          createPortal(
            createElement("button", {
              events: [on("click", () => calls.push("button"))],
            }),
            portalTarget(target),
          ),
        ),
      ),
    );

    const button = target.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(calls).toEqual(["button", "parent"]);
  });

  it("removes portal content on unmount", () => {
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createPortal(
          createElement("span", null, "Portal"),
          portalTarget(target),
        ),
      ),
    );
    flushSync(() => root.unmount());

    expect(container.textContent).toBe("");
    expect(target.textContent).toBe("");
  });
});
