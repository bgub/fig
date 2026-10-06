// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { createPartSlot } from "./parts.ts";

it("keeps a newer binding to the same host when its predecessor aborts", () => {
  const slot = createPartSlot(() => {});
  const node = document.createElement("button");
  const first = new AbortController();
  const second = new AbortController();
  slot.bind(node, first.signal);
  slot.bind(node, second.signal);
  first.abort();
  expect(slot.node()).toBe(node);
  second.abort();
  expect(slot.node()).toBeNull();
});
