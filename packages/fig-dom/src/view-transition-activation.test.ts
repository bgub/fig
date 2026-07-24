// @vitest-environment happy-dom
import { createElement, transition, ViewTransition } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { act } from "./act.ts";
import { createRoot } from "./index.ts";

describe("View Transition activation", () => {
  it("is inert on import and can activate after root creation", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const { enableViewTransitions } = await import("./view-transitions.ts");
    const calls: string[] = [];
    const warnings: string[] = [];
    const ownerDocument = document as unknown as {
      startViewTransition?: (input: (() => void) | { update: () => void }) => {
        finished: Promise<unknown>;
        ready: Promise<unknown>;
      };
    };
    const previousStart = ownerDocument.startViewTransition;
    const previousError = console.error;

    ownerDocument.startViewTransition = (input) => {
      calls.push(container.textContent ?? "");
      const update = typeof input === "function" ? input : input.update;
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };
    console.error = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    const render = (label: string) =>
      root.render(
        createElement(
          ViewTransition,
          { name: "card" },
          createElement("section", null, label),
        ),
      );

    try {
      await act(() => render("initial"));
      await act(() => transition(() => render("before activation")));
      expect(calls).toEqual([]);
      expect(
        warnings.filter((warning) =>
          warning.includes(
            'enableViewTransitions() from "@bgub/fig-dom/view-transitions"',
          ),
        ),
      ).toHaveLength(1);

      enableViewTransitions();
      await act(() => transition(() => render("after activation")));

      expect(calls).toEqual(["before activation"]);
      expect(warnings).toHaveLength(1);
      expect(container.textContent).toBe("after activation");
    } finally {
      console.error = previousError;
      ownerDocument.startViewTransition = previousStart;
    }
  });
});
