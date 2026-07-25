// @vitest-environment happy-dom
import {
  assets,
  createElement,
  meta,
  stylesheet,
  Suspense,
  title,
} from "@bgub/fig";
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
    document.querySelector("browser-overlay-root")?.remove();
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("preserves out-of-band document nodes through hydration and updates", () => {
    const doctype = document.implementation.createDocumentType("html", "", "");
    document.insertBefore(doctype, document.documentElement);
    const stylesheetHref = "data:text/css,/*app*/";
    document.head.innerHTML = `<script ${HYDRATION_SKIP_ATTRIBUTE}=""></script><link rel="preconnect" href="https://example.com"><meta ${HYDRATION_SKIP_ATTRIBUTE}="" charset="utf-8"><link ${HYDRATION_SKIP_ATTRIBUTE}="" rel="stylesheet" href="${stylesheetHref}">`;
    document.body.innerHTML = `<main>Ready</main><script ${HYDRATION_SKIP_ATTRIBUTE}="">globalThis.__figSSR={}</script><password-manager-root></password-manager-root>`;
    document.documentElement.appendChild(
      document.createElement("browser-overlay-root"),
    );
    const serverHtml = document.documentElement;
    const recoverableErrors: unknown[] = [];
    const renderDocument = (label: string) =>
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
        createElement(
          "body",
          null,
          assets(
            stylesheet(stylesheetHref),
            createElement("main", null, label),
          ),
        ),
      );

    const root = flushSync(() =>
      hydrateRoot(document, renderDocument("Ready"), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      }),
    );

    expect(recoverableErrors).toEqual([]);
    expect(document.documentElement).toBe(serverHtml);
    expect(document.doctype).toBe(doctype);
    expect(document.querySelectorAll("html")).toHaveLength(1);
    expect(document.querySelector("main")?.textContent).toBe("Ready");
    expect(document.body.querySelector("script")).not.toBeNull();
    expect(document.querySelector("password-manager-root")).not.toBeNull();
    expect(document.querySelector("browser-overlay-root")).not.toBeNull();

    flushSync(() => root.render(renderDocument("Updated")));

    expect(document.documentElement).toBe(serverHtml);
    expect(
      document.querySelector(`link[href="${stylesheetHref}"]`),
    ).not.toBeNull();
    expect(document.querySelector("main")?.textContent).toBe("Updated");
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

  it("recovers a full-document mismatch inside a completed Suspense boundary", async () => {
    const serverDocument = document.implementation.createHTMLDocument("");
    const doctype = document.implementation.createDocumentType("html", "", "");
    const start = serverDocument.createComment("fig:suspense:completed");
    const end = serverDocument.createComment("/fig:suspense");
    serverDocument.insertBefore(doctype, serverDocument.documentElement);
    serverDocument.insertBefore(start, doctype);
    serverDocument.appendChild(end);
    serverDocument.body.innerHTML = "<main>Server</main>";
    const recoverableErrors: unknown[] = [];

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
              createElement("head"),
              createElement(
                "body",
                null,
                createElement("main", null, "Client"),
              ),
            ),
          ),
          { onRecoverableError: (error) => recoverableErrors.push(error) },
        ),
      ),
    ).not.toThrow();

    await waitForHostTurns();

    expect(recoverableErrors).toHaveLength(1);
    expect(serverDocument.doctype).toBe(doctype);
    expect(serverDocument.querySelectorAll("html")).toHaveLength(1);
    expect(serverDocument.querySelector("main")?.textContent).toBe("Client");
  });

  it("retains document assets through root hydration recovery and updates", () => {
    const previousDocument = globalThis.document;
    const serverDocument = document.implementation.createHTMLDocument("");
    const stylesheetHref = "data:text/css,/*recovery*/";
    serverDocument.head.innerHTML = `<title ${HYDRATION_SKIP_ATTRIBUTE}="">Page</title><meta ${HYDRATION_SKIP_ATTRIBUTE}="" name="description" content="Description"><style ${HYDRATION_SKIP_ATTRIBUTE}="">/* critical */</style><script ${HYDRATION_SKIP_ATTRIBUTE}="">/* bootstrap */</script><link ${HYDRATION_SKIP_ATTRIBUTE}="" rel="stylesheet" href="${stylesheetHref}">`;
    serverDocument.body.innerHTML = "<main>Server</main>";
    const serverHtml = serverDocument.documentElement;
    const serverHead = serverDocument.head;
    const serverBody = serverDocument.body;
    const serverStylesheet = serverDocument.querySelector(
      `link[href="${stylesheetHref}"]`,
    );
    const serverStyle = serverDocument.querySelector("style");
    const serverScript = serverDocument.querySelector("head script");
    const removedDuringRecovery: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        removedDuringRecovery.push(...record.removedNodes);
      }
    });
    observer.observe(serverDocument, { childList: true, subtree: true });
    const recoverableErrors: unknown[] = [];
    const renderDocument = (label: string) =>
      createElement(
        "html",
        null,
        createElement("head"),
        createElement(
          "body",
          null,
          assets(
            [
              title("Page"),
              meta({ content: "Description", name: "description" }),
              stylesheet(stylesheetHref),
            ],
            createElement("main", null, label),
          ),
        ),
      );

    globalThis.document = serverDocument;
    try {
      const root = flushSync(() =>
        hydrateRoot(serverDocument, renderDocument("Client"), {
          onRecoverableError: (error) => recoverableErrors.push(error),
        }),
      );
      for (const record of observer.takeRecords()) {
        removedDuringRecovery.push(...record.removedNodes);
      }

      expect(recoverableErrors).toHaveLength(1);
      expect(removedDuringRecovery).not.toContain(serverHtml);
      expect(removedDuringRecovery).not.toContain(serverHead);
      expect(removedDuringRecovery).not.toContain(serverBody);
      expect(removedDuringRecovery).not.toContain(serverStylesheet);
      expect(removedDuringRecovery).not.toContain(serverStyle);
      expect(removedDuringRecovery).not.toContain(serverScript);
      expect(serverDocument.documentElement).toBe(serverHtml);
      expect(serverDocument.head).toBe(serverHead);
      expect(serverDocument.body).toBe(serverBody);
      expect(
        serverDocument.querySelector(`link[href="${stylesheetHref}"]`),
      ).toBe(serverStylesheet);
      expect(serverDocument.querySelector("style")).toBe(serverStyle);
      expect(serverDocument.querySelector("head script")).toBe(serverScript);
      expect(serverStylesheet?.isConnected).toBe(true);
      expect(serverDocument.querySelector("main")?.textContent).toBe("Client");
      expect(serverDocument.title).toBe("Page");
      expect(
        serverDocument
          .querySelector('meta[name="description"]')
          ?.getAttribute("content"),
      ).toBe("Description");
      expect(
        serverDocument.querySelectorAll(`link[href="${stylesheetHref}"]`),
      ).toHaveLength(1);

      flushSync(() => root.render(renderDocument("Updated")));

      expect(serverDocument.querySelector("main")?.textContent).toBe("Updated");
      expect(serverDocument.title).toBe("Page");
      expect(
        serverDocument.querySelectorAll(`link[href="${stylesheetHref}"]`),
      ).toHaveLength(1);

      root.unmount();

      expect(serverDocument.documentElement).toBe(serverHtml);
      expect(serverDocument.head).toBe(serverHead);
      expect(serverDocument.body).toBe(serverBody);
      expect(
        serverDocument.querySelector(`link[href="${stylesheetHref}"]`),
      ).toBe(serverStylesheet);
      expect(serverDocument.querySelector("style")).toBe(serverStyle);
      expect(serverDocument.querySelector("head script")).toBe(serverScript);
      expect(serverDocument.querySelector("main")).toBeNull();
    } finally {
      observer.disconnect();
      globalThis.document = previousDocument;
    }
  });

  it("reports a hydration mismatch when no recoverable error handler is provided", () => {
    const previousDocument = globalThis.document;
    const serverDocument = document.implementation.createHTMLDocument("");
    serverDocument.body.innerHTML = "<main>Server</main>";
    const reported: unknown[][] = [];
    const previousError = console.error;

    globalThis.document = serverDocument;
    console.error = (...args: unknown[]) => reported.push(args);
    try {
      flushSync(() =>
        hydrateRoot(
          serverDocument,
          createElement(
            "html",
            null,
            createElement("head"),
            createElement("body", null, createElement("main", null, "Client")),
          ),
        ),
      );

      expect(reported).toHaveLength(1);
      expect(reported[0]?.[0]).toBeInstanceOf(Error);
      expect(serverDocument.querySelector("main")?.textContent).toBe("Client");
    } finally {
      console.error = previousError;
      globalThis.document = previousDocument;
    }
  });
});
