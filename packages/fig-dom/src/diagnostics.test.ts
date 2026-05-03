import { createElement, type FigNode } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

function expectRenderDiagnostic(node: FigNode, message: string): void {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);

  flushSync(() => root.render(createElement("main", null, "Stable")));

  expect(() => {
    flushSync(() => root.render(node));
  }).toThrow(message);

  expect(container.textContent).toBe("");

  flushSync(() => root.render(createElement("main", null, "Recovered")));
  expect(container.textContent).toBe("Recovered");
}

describe("@bgub/fig-dom diagnostics", () => {
  it("throws on duplicate sibling keys without committing failed work", () => {
    expectRenderDiagnostic(
      createElement(
        "ul",
        null,
        createElement("li", { key: "same" }, "A"),
        createElement("li", { key: "same" }, "B"),
      ),
      'Duplicate key "same" found among siblings.',
    );
  });

  it("throws on invalid children without committing failed work", () => {
    function Broken() {
      return { nope: true } as unknown as FigNode;
    }

    expectRenderDiagnostic(
      createElement(Broken, null),
      "Invalid Fig child: object with keys nope.",
    );
  });
});
