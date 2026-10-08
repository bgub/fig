// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createAnchoredPopup } from "./anchored-popup.ts";

afterEach(() => document.body.replaceChildren());

it("opens a replacement popup when the widget remains open", () => {
  const registry = createAnchoredPopup(() => {}, "popover");
  const first = document.createElement("div");
  const replacement = document.createElement("div");
  const firstShow = vi.fn();
  const nextShow = vi.fn();
  Object.assign(first, {
    showPopover: firstShow,
    hidePopover: vi.fn(),
    matches: () => false,
  });
  Object.assign(replacement, {
    showPopover: nextShow,
    hidePopover: vi.fn(),
    matches: () => false,
  });
  document.body.append(first);
  const binding = new AbortController();
  registry.bindPopup(first, binding.signal);
  registry.sync(true, "--test");
  expect(firstShow).toHaveBeenCalledOnce();

  binding.abort();
  first.replaceWith(replacement);
  registry.bindPopup(replacement, new AbortController().signal);
  registry.sync(true, "--test");
  expect(nextShow).toHaveBeenCalledOnce();
});

it("passes the anchor as the native invoker for a separately mounted popup", () => {
  const registry = createAnchoredPopup(() => {}, "menu");
  const parent = document.createElement("div");
  parent.setAttribute("popover", "auto");
  const trigger = document.createElement("button");
  parent.append(trigger);
  const child = document.createElement("div");
  child.setAttribute("popover", "auto");
  document.body.append(parent, child);
  const show = vi.fn();
  Object.assign(child, {
    showPopover: show,
    hidePopover: vi.fn(),
    matches: () => false,
  });
  const binding = new AbortController();
  registry.bindAnchor(trigger, binding.signal);
  registry.bindPopup(child, binding.signal);
  registry.sync(true, "--child");
  expect(show).toHaveBeenCalledExactlyOnceWith({ source: trigger });
});

it("keeps CSS anchor and native source registrations independent on the same host", () => {
  const registry = createAnchoredPopup(() => {}, "menu");
  const trigger = document.createElement("button");
  const popup = document.createElement("div");
  const anchorBinding = new AbortController();
  const sourceBinding = new AbortController();
  registry.bindAnchor(trigger, anchorBinding.signal);
  registry.bindSource(trigger, sourceBinding.signal);
  registry.bindPopup(popup, new AbortController().signal);
  registry.sync(false, "--test-menu");
  expect(registry.anchor()).toBe(trigger);
  expect(trigger.style.getPropertyValue("anchor-name")).toBe("--test-menu");
  sourceBinding.abort();
  expect(registry.anchor()).toBe(trigger);
});
