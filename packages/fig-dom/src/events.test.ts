import { createElement } from "@bgub/fig";
import { requestUpdateLane } from "@bgub/fig-reconciler";
import { describe, expect, it } from "vite-plus/test";
import {
  createRoot,
  DefaultLane,
  flushSync,
  InputContinuousLane,
  on,
  render,
  SyncLane,
} from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom events", () => {
  it("runs DOM event handlers with event priority", () => {
    const lanes: number[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on("click", () => lanes.push(requestUpdateLane())),
            on("mousemove", () => lanes.push(requestUpdateLane())),
            on("load", () => lanes.push(requestUpdateLane())),
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

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on("mousedown", () => lanes.push(requestUpdateLane())),
            on("contextmenu", () => lanes.push(requestUpdateLane())),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("mousedown");
    button.dispatch("contextmenu");

    expect(lanes).toEqual([SyncLane, SyncLane]);
  });

  it("keeps sibling slots stable when a once handler fires", () => {
    const aborts: string[] = [];
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const app = (label: string) =>
      createElement("button", {
        events: [
          on("click", () => calls.push(`once:${label}`), { once: true }),
          on("click", (_event, signal) => {
            calls.push(`sibling:${label}`);
            signal.addEventListener("abort", () => aborts.push(label));
          }),
        ],
      });

    flushSync(() => root.render(app("one")));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");
    expect(calls).toEqual(["once:one", "sibling:one"]);

    // A consumed once slot must not shift its siblings: the same-key
    // re-render updates the sibling's callback in place without tearing it
    // down (which would abort its in-flight signal) or re-arming the once.
    flushSync(() => root.render(app("two")));
    expect(aborts).toEqual([]);

    button.dispatch("click");
    expect(calls).toEqual(["once:one", "sibling:one", "sibling:two"]);
  });

  it("aborts a once handler's signal even when it throws", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    let aborted = false;

    flushSync(() =>
      root.render(
        createElement("button", {
          events: [
            on(
              "click",
              (_event, signal) => {
                signal.addEventListener("abort", () => {
                  aborted = true;
                });
                throw new Error("boom");
              },
              { once: true },
            ),
          ],
        }),
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    expect(() => button.dispatch("click")).toThrow("boom");
    expect(aborted).toBe(true);
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

  it("delegates focus-like events through capture with Fig bubble semantics", () => {
    for (const type of ["focus", "blur"]) {
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

      expect(container.listenerSets[type]).toHaveLength(1);
      expect(button.listenerSets[type]).toBeUndefined();

      button.dispatch(type);

      expect(calls).toEqual([
        "parent:capture",
        "child:bubble",
        "parent:bubble",
      ]);
    }
  });

  it("uses direct listeners for non-bubbling scroll and enter/leave events", () => {
    for (const type of ["scroll", "mouseenter", "mouseleave"]) {
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

  it("cleans up once event listeners after dispatch", () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on(
              "click",
              (_event, signal) => {
                calls.push("click");
                signals.push(signal);
              },
              { once: true },
            ),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;

    button.dispatch("click");
    button.dispatch("click");

    expect(calls).toEqual(["click"]);
    expect(signals[0].aborted).toBe(true);
    expect(container.listeners.click).toBeUndefined();
  });

  it("cleans up delegated once listeners when callbacks throw", () => {
    let calls = 0;
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on(
              "click",
              () => {
                calls += 1;
                throw new Error("boom");
              },
              { once: true },
            ),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;

    expect(() => button.dispatch("click")).toThrow("boom");
    expect(calls).toBe(1);
    expect(container.listeners.click).toBeUndefined();

    expect(() => button.dispatch("click")).not.toThrow();
    expect(calls).toBe(1);
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
