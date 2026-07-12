// @vitest-environment happy-dom
import { createElement } from "@bgub/fig";
import {
  EARLY_EVENT_HANDLER_PROPERTY,
  EARLY_EVENT_QUEUE_PROPERTY,
  REPLAYABLE_EVENT_TYPES,
} from "@bgub/fig/internal";
import { describe, expect, it } from "vitest";
import { act } from "./act.ts";
import { hydrateRoot, on } from "./index.ts";

type EarlyEventCarrier = Document & {
  [EARLY_EVENT_QUEUE_PROPERTY]?: Event[];
  [EARLY_EVENT_HANDLER_PROPERTY]?: (event: Event) => void;
};

// Installs exactly what the server's inline capture script installs — the
// EARLY_EVENT_* contract from @bgub/fig/internal that fig-dom adopts from.
function installEarlyCapture(): void {
  const carrier = document as EarlyEventCarrier;
  const queue: Event[] = [];
  const handler = (event: Event): void => {
    // happy-dom nulls event.target once dispatch completes; browsers keep
    // it (the WHATWG dispatch cleanup resets currentTarget and the path,
    // not target). Pin it so the queued event reads like a browser's.
    Object.defineProperty(event, "target", {
      configurable: true,
      value: event.target,
    });
    queue.push(event);
  };
  carrier[EARLY_EVENT_QUEUE_PROPERTY] = queue;
  carrier[EARLY_EVENT_HANDLER_PROPERTY] = handler;
  for (const type of REPLAYABLE_EVENT_TYPES) {
    document.addEventListener(type, handler, true);
  }
}

describe("early event replay", () => {
  it("replays a click captured before the bundle executed", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<button>Server</button>";
    document.body.append(container);
    installEarlyCapture();

    // The user clicks while only the inline capture script exists: no
    // hydration listeners, no handlers, nothing but the queue.
    const button = container.querySelector("button") as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const clicks: string[] = [];

    try {
      await act(() =>
        hydrateRoot(
          container,
          createElement(
            "button",
            { events: [on("click", () => clicks.push("click"))] },
            "Server",
          ),
        ),
      );
      await Promise.resolve();

      expect(clicks).toEqual(["click"]);

      // Adoption tears the capture contract down: the globals are gone and
      // a live click dispatches exactly once (no leftover capture handler).
      const carrier = document as EarlyEventCarrier;
      expect(carrier[EARLY_EVENT_QUEUE_PROPERTY]).toBeUndefined();
      expect(carrier[EARLY_EVENT_HANDLER_PROPERTY]).toBeUndefined();

      clicks.length = 0;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(clicks).toEqual(["click"]);
    } finally {
      container.remove();
    }
  });

  it("drops captured events whose targets are outside the root", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<button>Server</button>";
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(container, outside);
    installEarlyCapture();

    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const clicks: string[] = [];

    try {
      await act(() =>
        hydrateRoot(
          container,
          createElement(
            "button",
            { events: [on("click", () => clicks.push("click"))] },
            "Server",
          ),
        ),
      );
      await Promise.resolve();

      expect(clicks).toEqual([]);
    } finally {
      container.remove();
      outside.remove();
    }
  });
});
