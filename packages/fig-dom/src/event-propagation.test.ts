import { describe, expect, it } from "vitest";
import { withPropagationState } from "./event-propagation.ts";

describe("event propagation state", () => {
  it("reflects a logical stop when cancelBubble is read-only", () => {
    let stopped = false;
    const event = {
      get cancelBubble() {
        return stopped;
      },
      stopImmediatePropagation() {
        stopped = true;
      },
      stopPropagation() {
        stopped = true;
      },
    } as Event;

    withPropagationState(event, false, () => {
      event.cancelBubble = true;
    });

    expect(stopped).toBe(true);
  });
});
