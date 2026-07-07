import { createElement, type FigNode } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
// White-box import of the reconciler's lane module (aliased to source, so it
// shares state with the reconciler under test): lanes are the precise
// observable for handler priority — any public projection would collapse
// tiers and hide a regression that ran handlers at transition/idle lanes.
import {
  DefaultLane,
  InputContinuousLane,
  requestUpdateLane,
  SyncLane,
} from "../../fig-reconciler/src/lanes.ts";
import { createRoot, flushSync, on } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

function render(node: FigNode, container: Element): void {
  const root = createRoot(container);
  root.render(node);
}

describe("@bgub/fig-dom events", () => {
  it("runs DOM event handlers with event priority", () => {
    const lanes: number[] = [];
    const container = new FakeElement("root");
    const record = () => {
      lanes.push(requestUpdateLane());
    };

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on("click", record),
            on("mousemove", record),
            on("load", record),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");
    button.dispatch("mousemove");
    button.dispatch("load");

    expect(lanes).toEqual([SyncLane, InputContinuousLane, DefaultLane]);
  });

  it("runs press interactions at discrete priority", () => {
    const lanes: number[] = [];
    const container = new FakeElement("root");
    const record = () => lanes.push(requestUpdateLane());

    flushSync(() =>
      render(
        createElement("button", {
          events: [on("mousedown", record), on("contextmenu", record)],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("mousedown");
    button.dispatch("contextmenu");

    expect(lanes).toEqual([SyncLane, SyncLane]);
  });

  it("ignores falsy event entries without shifting listener slots", () => {
    const aborts: string[] = [];
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const app = (enabled: boolean, label: string) =>
      createElement("button", {
        events: [
          false,
          enabled &&
            on("pointermove", () => calls.push(`conditional:${label}`)),
          null,
          on("click", (_event, signal) => {
            calls.push(`stable:${label}`);
            signal.addEventListener("abort", () => aborts.push(label));
          }),
          undefined,
        ],
      });

    flushSync(() => root.render(app(false, "one")));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");
    expect(calls).toEqual(["stable:one"]);

    flushSync(() => root.render(app(false, "two")));
    expect(aborts).toEqual([]);
    button.dispatch("click");
    expect(calls).toEqual(["stable:one", "stable:two"]);

    const abortCount = aborts.length;
    flushSync(() => root.render(app(true, "three")));
    expect(aborts).toHaveLength(abortCount);
    button.dispatch("pointermove");
    button.dispatch("click");
    expect(calls).toEqual([
      "stable:one",
      "stable:two",
      "conditional:three",
      "stable:three",
    ]);
  });

  it("dispatches handlers subscribed at event time despite re-entrant commits", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const second = () => calls.push("second");

    function App({ both }: { both: boolean }) {
      return createElement("button", {
        events: both
          ? [
              on("click", () => {
                calls.push("first");
                flushSync(() =>
                  root.render(createElement(App, { both: false })),
                );
              }),
              on("click", second),
            ]
          : [on("click", second)],
      });
    }

    flushSync(() => root.render(createElement(App, { both: true })));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");

    // "second" was subscribed when the event fired (and still is after the
    // re-entrant commit); the mid-dispatch slot mutation must not skip it.
    expect(calls).toEqual(["first", "second"]);
  });

  it("delegates events from the root with element currentTarget", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [
              on("click", (event) => {
                calls.push(
                  `main:${(event.currentTarget as unknown as FakeElement).tagName}`,
                );
              }),
            ],
          },
          createElement("button", {
            events: [
              on("click", (event) => {
                calls.push(
                  `button:${(event.currentTarget as unknown as FakeElement).tagName}`,
                );
              }),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    expect(container.listenerSets.click).toHaveLength(1);
    expect(button.listenerSets.click).toBeUndefined();

    button.dispatch("click");

    expect(calls).toEqual(["button:button", "main:main"]);
  });

  it("lets events from a nested root bubble to outer root handlers", () => {
    const calls: string[] = [];
    const outerContainer = new FakeElement("outer-root");
    const outerRoot = createRoot(outerContainer as unknown as Element);

    flushSync(() =>
      outerRoot.render(
        createElement(
          "section",
          { events: [on("click", () => calls.push("outer"))] },
          createElement("div", null),
        ),
      ),
    );

    const section = outerContainer.childNodes[0] as FakeElement;
    const innerContainer = section.childNodes[0] as FakeElement;
    const innerRoot = createRoot(innerContainer as unknown as Element);

    flushSync(() =>
      innerRoot.render(
        createElement("button", {
          events: [on("click", () => calls.push("inner"))],
        }),
      ),
    );

    const button = innerContainer.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(calls).toEqual(["inner", "outer"]);
  });

  it("attaches non-bubbling events directly to their element", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          { events: [on("load", () => calls.push("main"))] },
          createElement("img", {
            events: [
              on("load", () => calls.push("img:load")),
              on("pointerenter", () => calls.push("img:pointerenter")),
            ],
          }),
          createElement("video", {
            events: [on("play", () => calls.push("video:play"))],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const img = main.childNodes[0] as FakeElement;
    const video = main.childNodes[1] as FakeElement;

    // Direct listeners live on the element, not the delegation root.
    expect(img.listenerSets.load).toHaveLength(1);
    expect(container.listenerSets.load).toBeUndefined();

    img.dispatch("load");
    img.dispatch("pointerenter");
    video.dispatch("play");

    // Non-bubbling events fire on their target only: the ancestor's load
    // handler must not observe the img's load.
    expect(calls).toEqual(["img:load", "img:pointerenter", "video:play"]);
  });

  it("handles delegated custom event types containing colons", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const app = (listen: boolean) =>
      createElement("button", {
        events: listen ? [on("htmx:afterSwap", () => calls.push("swap"))] : [],
      });

    flushSync(() => root.render(app(true)));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("htmx:afterSwap");
    expect(calls).toEqual(["swap"]);
    expect(container.listenerSets["htmx:afterSwap"]).toHaveLength(1);

    // Removing the handler must detach the full colon-containing type, not a
    // prefix parsed out of the listener key.
    flushSync(() => root.render(app(false)));

    expect(container.listenerSets["htmx:afterSwap"]).toBeUndefined();
    expect(container.listenerSets.htmx).toBeUndefined();
  });

  it("updates event descriptors without duplicating handlers", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Button({ label }: { label: string }) {
      return createElement("button", {
        events: [
          on("click", () => calls.push(`first:${label}`)),
          on("click", () => calls.push(`second:${label}`)),
        ],
      });
    }

    flushSync(() => root.render(createElement(Button, { label: "one" })));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");

    flushSync(() => root.render(createElement(Button, { label: "two" })));

    expect(container.listenerSets.click).toHaveLength(1);
    expect(button.listenerSets.click).toBeUndefined();
    button.dispatch("click");

    expect(calls).toEqual([
      "first:one",
      "second:one",
      "first:two",
      "second:two",
    ]);
  });

  it("dispatches capture and bubble events in order", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [
              on("click", () => calls.push("parent:capture"), {
                capture: true,
              }),
              on("click", () => calls.push("parent:bubble")),
            ],
          },
          createElement("button", {
            events: [
              on("click", () => calls.push("child:capture"), {
                capture: true,
              }),
              on("click", () => calls.push("child:bubble")),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    expect(container.listenerSets.click).toHaveLength(2);
    button.dispatch("click");

    expect(calls).toEqual([
      "parent:capture",
      "child:capture",
      "child:bubble",
      "parent:bubble",
    ]);
  });

  it("stops delegated propagation", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [on("click", () => calls.push("parent"))],
          },
          createElement("button", {
            events: [
              on("click", (event) => {
                calls.push("child");
                event.stopPropagation();
              }),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    button.dispatch("click");

    expect(calls).toEqual(["child"]);
  });

  it("continues same-target delegated handlers after stopPropagation", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [on("click", () => calls.push("parent"))],
          },
          createElement("button", {
            events: [
              on("click", (event) => {
                calls.push("child:first");
                event.stopPropagation();
              }),
              on("click", () => calls.push("child:second")),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    button.dispatch("click");

    expect(calls).toEqual(["child:first", "child:second"]);
  });

  it("delegates the native bubbling focusin/focusout with Fig bubble semantics", () => {
    for (const type of ["focusin", "focusout"]) {
      const calls: string[] = [];
      const container = new FakeElement("root");

      flushSync(() =>
        render(
          createElement(
            "main",
            {
              events: [
                on(type, () => calls.push("parent:capture"), {
                  capture: true,
                }),
                on(type, () => calls.push("parent:bubble")),
              ],
            },
            createElement("button", {
              events: [on(type, () => calls.push("child:bubble"))],
            }),
          ),
          container as unknown as Element,
        ),
      );

      const main = container.childNodes[0] as FakeElement;
      const button = main.childNodes[0] as FakeElement;

      expect(container.listenerSets[type]).toHaveLength(2);
      expect(button.listenerSets[type]).toBeUndefined();

      button.dispatch(type);

      expect(calls).toEqual([
        "parent:capture",
        "child:bubble",
        "parent:bubble",
      ]);
    }
  });

  it("uses direct listeners for non-bubbling events, focus/blur included", () => {
    // No React-style bubbling emulation: focus and blur keep their native
    // non-bubbling semantics, so only the target's own listener fires.
    // Ancestor-level focus tracking uses focusin/focusout (test above).
    for (const type of [
      "scroll",
      "mouseenter",
      "mouseleave",
      "focus",
      "blur",
    ]) {
      const calls: string[] = [];
      const container = new FakeElement("root");

      flushSync(() =>
        render(
          createElement(
            "main",
            {
              events: [on(type, () => calls.push("parent"))],
            },
            createElement("button", {
              events: [on(type, () => calls.push("child"))],
            }),
          ),
          container as unknown as Element,
        ),
      );

      const main = container.childNodes[0] as FakeElement;
      const button = main.childNodes[0] as FakeElement;

      expect(container.listenerSets[type]).toBeUndefined();
      expect(main.listenerSets[type]).toHaveLength(1);
      expect(button.listenerSets[type]).toHaveLength(1);

      button.dispatch(type);

      expect(calls).toEqual(["child"]);
    }
  });

  it("keeps delegated root listeners while sibling handlers remain", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ showFirst }: { showFirst: boolean }) {
      return createElement(
        "main",
        null,
        showFirst
          ? createElement("button", {
              key: "first",
              events: [on("click", () => calls.push("first"))],
            })
          : null,
        createElement("button", {
          key: "second",
          events: [on("click", () => calls.push("second"))],
        }),
      );
    }

    flushSync(() => root.render(createElement(App, { showFirst: true })));

    const main = container.childNodes[0] as FakeElement;
    const second = main.childNodes[1] as FakeElement;

    expect(container.listenerSets.click).toHaveLength(1);

    flushSync(() => root.render(createElement(App, { showFirst: false })));

    expect(container.listenerSets.click).toHaveLength(1);
    second.dispatch("click");

    expect(calls).toEqual(["second"]);
  });

  it("aborts event signals on re-entry and listener removal", () => {
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Button({ label }: { label: string }) {
      return createElement("button", {
        events: [
          on("click", (_event, signal) => {
            signals.push(signal);
            calls.push(label);
          }),
        ],
      });
    }

    const calls: string[] = [];

    flushSync(() => root.render(createElement(Button, { label: "one" })));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");
    expect(signals[0].aborted).toBe(false);

    flushSync(() => root.render(createElement(Button, { label: "two" })));

    expect(signals[0].aborted).toBe(false);
    button.dispatch("click");

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(calls).toEqual(["one", "two"]);

    flushSync(() => root.render(createElement("button", null)));

    expect(signals[1].aborted).toBe(true);
    expect(container.listeners.click).toBeUndefined();
  });
});
