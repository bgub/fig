// @vitest-environment happy-dom
import { createElement } from "@bgub/fig";
import { flushSync, hydrateRoot } from "./index.ts";
import { afterEach, describe, expect, it } from "vitest";

describe("document hydration", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("hydrates a full document root", () => {
    document.head.innerHTML = '<meta charset="utf-8">';
    document.body.innerHTML = "<main>Ready</main>";

    flushSync(() =>
      hydrateRoot(
        document,
        createElement(
          "html",
          null,
          createElement(
            "head",
            null,
            createElement("meta", { charset: "utf-8" }),
          ),
          createElement("body", null, createElement("main", null, "Ready")),
        ),
      ),
    );

    expect(document.querySelectorAll("html")).toHaveLength(1);
    expect(document.querySelector("main")?.textContent).toBe("Ready");
  });
});
