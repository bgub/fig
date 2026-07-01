import { createElement, type FigNode } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createPortal, createRoot, flushSync } from "./index.ts";
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

function expectValidRender(node: FigNode, text: string): void {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);

  flushSync(() => root.render(node));
  expect(container.textContent).toContain(text);
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

  it("throws when unsafeHTML is mixed with children", () => {
    expectRenderDiagnostic(
      createElement("section", { unsafeHTML: "<strong>Fig</strong>" }, "Fig"),
      "Host elements cannot have both unsafeHTML and children.",
    );
  });

  it("throws on invalid table nesting before commit", () => {
    expectRenderDiagnostic(
      createElement(
        "table",
        null,
        createElement("tr", null, createElement("td", null, "Cell")),
      ),
      "Invalid DOM nesting: <tr> cannot be a child of <table>.",
    );
  });

  it("throws on invalid select nesting before commit", () => {
    expectRenderDiagnostic(
      createElement("select", null, createElement("div", null, "Nope")),
      "Invalid DOM nesting: <div> cannot be a child of <select>.",
    );
  });

  it("throws on invalid text nesting before commit", () => {
    expectRenderDiagnostic(
      createElement("table", null, "Text"),
      "Invalid DOM nesting: text cannot be a child of <table>.",
    );
  });

  it("throws on invalid ancestor nesting before commit", () => {
    expectRenderDiagnostic(
      createElement(
        "button",
        null,
        createElement("span", null, createElement("button", null, "Nested")),
      ),
      "Invalid DOM nesting: <button> cannot appear inside <button>.",
    );
  });

  it("throws on p auto-closing descendants before commit", () => {
    expectRenderDiagnostic(
      createElement("p", null, createElement("div", null, "Block")),
      "Invalid DOM nesting: <div> cannot appear inside <p>.",
    );
  });

  it("allows p descendants past a button scope boundary", () => {
    expectValidRender(
      createElement(
        "p",
        null,
        createElement("button", null, createElement("div", null, "Icon")),
      ),
      "Icon",
    );
  });

  it("allows anchor nesting past a table scope boundary", () => {
    expectValidRender(
      createElement(
        "a",
        { href: "/card" },
        createElement(
          "table",
          null,
          createElement(
            "tbody",
            null,
            createElement(
              "tr",
              null,
              createElement(
                "td",
                null,
                createElement("a", { href: "/cell" }, "Link"),
              ),
            ),
          ),
        ),
      ),
      "Link",
    );
  });

  it("throws on table parts outside table context before commit", () => {
    expectRenderDiagnostic(
      createElement("div", null, createElement("td", null, "Cell")),
      "Invalid DOM nesting: <td> cannot be a child of <div>.",
    );
  });

  it("throws on list items auto-closed by an ancestor list item", () => {
    expectRenderDiagnostic(
      createElement(
        "ul",
        null,
        createElement(
          "li",
          null,
          createElement("div", null, createElement("li", null, "Nested")),
        ),
      ),
      "Invalid DOM nesting: <li> cannot appear inside <li>.",
    );
  });

  it("allows list items in a nested list", () => {
    expectValidRender(
      createElement(
        "ul",
        null,
        createElement(
          "li",
          null,
          createElement("ul", null, createElement("li", null, "Nested")),
        ),
      ),
      "Nested",
    );
  });

  it("throws when the root container makes nesting invalid", () => {
    const container = new FakeElement("p");
    const root = createRoot(container as unknown as Element);

    expect(() => {
      flushSync(() => root.render(createElement("div", null, "Block")));
    }).toThrow("Invalid DOM nesting: <div> cannot appear inside <p>.");
  });

  it("throws when a portal target makes nesting invalid", () => {
    const container = new FakeElement("root");
    const target = new FakeElement("select");
    const root = createRoot(container as unknown as Element);

    expect(() => {
      flushSync(() =>
        root.render(
          createPortal(
            createElement("div", null, "Nope"),
            target as unknown as Element,
          ),
        ),
      );
    }).toThrow("Invalid DOM nesting: <div> cannot be a child of <select>.");
  });

  it("allows hoisted asset resources in restricted parents", () => {
    expectValidRender(
      createElement(
        "table",
        null,
        createElement(
          "tbody",
          null,
          createElement(
            "tr",
            null,
            createElement("td", null, "Cell"),
            createElement("link", {
              href: "/table.css",
              precedence: "app",
              rel: "stylesheet",
            }),
          ),
        ),
      ),
      "Cell",
    );
  });

  it("allows whitespace-only text inside tables", () => {
    expectValidRender(
      createElement(
        "table",
        null,
        " ",
        createElement(
          "tbody",
          null,
          createElement("tr", null, createElement("td", null, "Cell")),
        ),
        "\n  ",
      ),
      "Cell",
    );
  });
});
