// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  createDOMViewTransitionSurface,
  getViewTransitionPseudoElements,
} from "./view-transition-pseudos.ts";

const nativeAnimate = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "animate",
);
afterEach(() => {
  if (nativeAnimate)
    Object.defineProperty(document.documentElement, "animate", nativeAnimate);
  else Reflect.deleteProperty(document.documentElement, "animate");
  vi.restoreAllMocks();
});

it.each([false, true])(
  "releases every owned animation without enumerating the document (cancel throws: %s)",
  (cancelThrows) => {
    const first = vi.fn(() => {
      if (cancelThrows) throw new Error("cancel failed");
    });
    const second = vi.fn();
    const animate = vi
      .fn()
      .mockReturnValueOnce({ cancel: first })
      .mockReturnValueOnce({ cancel: second });
    Object.defineProperty(document.documentElement, "animate", {
      configurable: true,
      value: animate,
    });
    const controller = new AbortController();
    const surface = createDOMViewTransitionSurface(
      document.createElement("div"),
      "card",
      { old: true, new: true },
      controller.signal,
    );
    const pseudos = getViewTransitionPseudoElements(surface);
    pseudos.new?.animate(
      { opacity: [0, 1] },
      { duration: 100, fill: "forwards" },
    );
    pseudos.old?.animate({ opacity: [1, 0] }, 100);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    controller.abort();
    controller.abort();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  },
);

it("rejects expired surfaces and saved pseudo handles before accessing the DOM", () => {
  const animate = vi.fn();
  Object.defineProperty(document.documentElement, "animate", {
    configurable: true,
    value: animate,
  });
  const controller = new AbortController();
  const surface = createDOMViewTransitionSurface(
    document.createElement("div"),
    "card",
    { old: false, new: true },
    controller.signal,
  );
  const group = getViewTransitionPseudoElements(surface).group;
  controller.abort();
  expect(() => getViewTransitionPseudoElements(surface)).toThrow(
    "no longer active",
  );
  expect(() => group.animate({ opacity: [0, 1] })).toThrow("no longer active");
  expect(() => group.getAnimations()).toThrow("no longer active");
  expect(() => group.getComputedStyle()).toThrow("no longer active");
  expect(animate).not.toHaveBeenCalled();
});

it("keeps cancellation scoped when another transition reuses the same surface name", () => {
  const canceled = [vi.fn(), vi.fn()];
  const animate = vi
    .fn()
    .mockReturnValueOnce({ cancel: canceled[0] })
    .mockReturnValueOnce({ cancel: canceled[1] });
  Object.defineProperty(document.documentElement, "animate", {
    configurable: true,
    value: animate,
  });
  const controllers = [new AbortController(), new AbortController()];
  for (const controller of controllers) {
    const surface = createDOMViewTransitionSurface(
      document.createElement("div"),
      "card",
      { old: false, new: true },
      controller.signal,
    );
    getViewTransitionPseudoElements(surface).new?.animate({ opacity: [0, 1] });
  }
  controllers[0].abort();
  expect(canceled[0]).toHaveBeenCalledOnce();
  expect(canceled[1]).not.toHaveBeenCalled();
  controllers[1].abort();
  expect(canceled[1]).toHaveBeenCalledOnce();
});
