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

  it("bubbles portal events to ancestors without portal-inner handlers", () => {
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
            createElement("button", null, "Plain"),
            portalTarget(target),
          ),
        ),
      ),
    );

    // No portal-inner click handler exists, so only the root's mirrored
    // listener can route the event through the logical tree.
    const button = target.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(calls).toEqual(["parent"]);
  });

  it("runs ancestor capture handlers for portal events with different keys", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const target = new FakeElement("portal-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          {
            events: [
              on("click", () => calls.push("parent-capture"), {
                capture: true,
              }),
            ],
          },
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

    expect(calls).toEqual(["parent-capture", "button"]);
  });

  it("bubbles nested portal events through every logical ancestor", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const outerTarget = new FakeElement("outer-root");
    const innerTarget = new FakeElement("inner-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          { events: [on("click", () => calls.push("main"))] },
          createPortal(
            createElement(
              "section",
              { events: [on("click", () => calls.push("section"))] },
              createPortal(
                createElement("button", {
                  events: [on("click", () => calls.push("button"))],
                }),
                portalTarget(innerTarget),
              ),
            ),
            portalTarget(outerTarget),
          ),
        ),
      ),
    );

    const button = innerTarget.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(calls).toEqual(["button", "section", "main"]);
  });

  it("bubbles nested portal events when only an outer-portal ancestor listens", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const outerTarget = new FakeElement("outer-root");
    const innerTarget = new FakeElement("inner-root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createPortal(
            createElement(
              "section",
              { events: [on("click", () => calls.push("section"))] },
              createPortal(
                createElement("button", null, "Plain"),
                portalTarget(innerTarget),
              ),
            ),
            portalTarget(outerTarget),
          ),
        ),
      ),
    );

    // The click key lives only on the outer portal target (section's
    // listener target); the inner target needs its mirror to dispatch.
    const button = innerTarget.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(calls).toEqual(["section"]);
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
