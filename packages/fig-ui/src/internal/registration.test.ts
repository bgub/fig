// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createPartCollection, createPartSlot } from "./registration.ts";

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

it("updates one lifetime's configuration without adding abort listeners", () => {
  const collection = createPartCollection<string>();
  const node = document.createElement("div");
  const controller = new AbortController();
  const listener = vi.spyOn(controller.signal, "addEventListener");
  expect(collection.bind(node, controller.signal, "first")).toBe(true);
  expect(collection.bind(node, controller.signal, "second")).toBe(false);
  expect(collection.get(node)).toBe("second");
  expect(listener).toHaveBeenCalledOnce();
  controller.abort();
  expect(collection.items()).toEqual([]);
});

it("retires collection entries synchronously and protects successor registrations", () => {
  const collection = createPartCollection<number>();
  const node = document.createElement("div");
  const first = new AbortController(),
    second = new AbortController();
  collection.bind(node, first.signal, 1);
  collection.bind(node, second.signal, 2);
  first.abort();
  expect(collection.get(node)).toBe(2);
  second.abort();
  expect(collection.items()).toEqual([]);
});
