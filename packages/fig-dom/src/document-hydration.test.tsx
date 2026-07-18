// @vitest-environment happy-dom
import { createElement, Suspense } from "@bgub/fig";
import {
  HYDRATION_SKIP_ATTRIBUTE,
  preventAssetResourceHoist,
} from "@bgub/fig/internal";
import { flushSync, hydrateRoot } from "./index.ts";
import { waitForHostTurns } from "./test-utils.ts";
import { afterEach, describe, expect, it } from "vitest";

describe("document hydration", () => {
  afterEach(() => {
    if (document.doctype !== null) document.removeChild(document.doctype);
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("hydrates a full document around server-only and adopted head nodes", () => {
    const doctype = document.implementation.createDocumentType("html", "", "");
    document.insertBefore(doctype, document.documentElement);
    document.head.innerHTML = `<script ${HYDRATION_SKIP_ATTRIBUTE}=""></script><link rel="preconnect" href="https://example.com"><meta ${HYDRATION_SKIP_ATTRIBUTE}="" charset="utf-8">`;
    document.body.innerHTML = "<main>Ready</main>";
    const serverHtml = document.documentElement;
    const recoverableErrors: unknown[] = [];

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
            createElement(
              "link",
              preventAssetResourceHoist({
                href: "https://example.com",
                rel: "preconnect",
              }),
            ),
          ),
          createElement("body", null, createElement("main", null, "Ready")),
        ),
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      ),
    );

    expect(recoverableErrors).toEqual([]);
    expect(document.documentElement).toBe(serverHtml);
    expect(document.doctype).toBe(doctype);
    expect(document.querySelectorAll("html")).toHaveLength(1);
    expect(document.querySelector("main")?.textContent).toBe("Ready");
  });

  it("hydrates a document whose first DOM element follows a doctype", () => {
    const serverDocument = document.implementation.createHTMLDocument("");
    serverDocument.insertBefore(
      document.implementation.createDocumentType("html", "", ""),
      serverDocument.documentElement,
    );
    serverDocument.body.innerHTML = "<main>Ready</main>";
    const serverHtml = serverDocument.documentElement;
    const recoverableErrors: unknown[] = [];

    expect(serverDocument.firstChild?.nodeType).toBe(Node.DOCUMENT_TYPE_NODE);

    expect(() =>
      flushSync(() =>
        hydrateRoot(
          serverDocument,
          createElement(
            "html",
            null,
            createElement("head"),
            createElement("body", null, createElement("main", null, "Ready")),
          ),
          { onRecoverableError: (error) => recoverableErrors.push(error) },
        ),
      ),
    ).not.toThrow();

    expect(recoverableErrors).toEqual([]);
    expect(serverDocument.querySelectorAll("html")).toHaveLength(1);
    expect(serverDocument.documentElement).toBe(serverHtml);
    expect(serverDocument.doctype?.name).toBe("html");
    expect(serverDocument.querySelector("main")?.textContent).toBe("Ready");
  });

  it("hydrates a full document inside a completed Suspense boundary", async () => {
    const serverDocument = document.implementation.createHTMLDocument("");
    const doctype = document.implementation.createDocumentType("html", "", "");
    const start = serverDocument.createComment("fig:suspense:completed");
    const end = serverDocument.createComment("/fig:suspense");
    serverDocument.insertBefore(doctype, serverDocument.documentElement);
    serverDocument.insertBefore(start, doctype);
    serverDocument.appendChild(end);
    serverDocument.head.innerHTML = `<script ${HYDRATION_SKIP_ATTRIBUTE}=""></script><link rel="preconnect" href="https://example.com"><title ${HYDRATION_SKIP_ATTRIBUTE}="">Ready</title>`;
    serverDocument.body.innerHTML = "<main>Ready</main>";
    const serverHtml = serverDocument.documentElement;

    expect(() =>
      flushSync(() =>
        hydrateRoot(
          serverDocument,
          createElement(
            Suspense,
            { fallback: null },
            createElement(
              "html",
              null,
              createElement(
                "head",
                null,
                createElement(
                  "link",
                  preventAssetResourceHoist({
                    href: "https://example.com",
                    rel: "preconnect",
                  }),
                ),
              ),
              createElement("body", null, createElement("main", null, "Ready")),
            ),
          ),
        ),
      ),
    ).not.toThrow();

    await waitForHostTurns();

    expect(serverDocument.doctype).toBe(doctype);
    expect(serverDocument.documentElement).toBe(serverHtml);
    expect(start.parentNode).toBeNull();
    expect(end.parentNode).toBeNull();
    expect(serverDocument.querySelector("main")?.textContent).toBe("Ready");
  });
});
