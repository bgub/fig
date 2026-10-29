// @vitest-environment happy-dom
import {
  createElement as h,
  readPromise,
  Suspense,
  type FigNode,
} from "@bgub/fig";
import { flushSync, hydrateRoot } from "./index.ts";
import { expect, it } from "vitest";
import { renderToStream, renderToDocumentStream } from "@bgub/fig-server";
import { deferred, waitForHostTurns } from "./test-utils.ts";

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
] as const)(
  "removes staged content before hydration (document: %s, nested: %s)",
  async (fullDocument, nested) => {
    const failure = deferred<void>();
    const never = new Promise<void>(() => undefined);
    let server = true;
    function Notes(): FigNode {
      if (server) readPromise(failure.promise);
      return h("p", null, "notes");
    }
    function Inner(): FigNode {
      if (server) readPromise(never);
      return h("p", null, "inner");
    }
    const content = h(
      "main",
      null,
      h(
        Suspense,
        { fallback: h("p", null, "loading") },
        nested ? h(Suspense, { fallback: "inner loading" }, h(Inner)) : null,
        h(Notes),
      ),
    );
    const tree = fullDocument
      ? h("html", null, h("head"), h("body", null, content))
      : content;
    const result = (fullDocument ? renderToDocumentStream : renderToStream)(
      tree,
      { onError: () => ({ message: "expected server error" }) },
    );
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let html = "";
    try {
      const expectedContainers = nested ? 2 : 1;
      while (
        (html.match(/<div hidden id=/g) ?? []).length < expectedContainers
      ) {
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error("Expected staged content before failure");
        html += decoder.decode(chunk.value);
      }
      failure.reject(new Error("late failure"));
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        html += decoder.decode(chunk.value);
      }
      const doc = fullDocument
        ? new DOMParser().parseFromString(html, "text/html")
        : document;
      const host = fullDocument ? doc.body : doc.createElement("div");
      if (!fullDocument) {
        doc.body.append(host);
        host.innerHTML = html;
      }
      const scope = {};
      for (const script of host.querySelectorAll("script")) {
        // oxlint-disable-next-line typescript-eslint/no-implied-eval
        new Function("document", "globalThis", script.textContent ?? "")(
          doc,
          scope,
        );
      }
      expect(host.querySelectorAll("div[hidden][id]")).toHaveLength(0);
      server = false;
      const errors: Array<{ message: string; source: string }> = [];
      const root = flushSync(() =>
        hydrateRoot(fullDocument ? doc : host, tree, {
          onRecoverableError(error, info) {
            if (!(error instanceof Error)) throw error;
            errors.push({ message: error.message, source: info.source });
          },
        }),
      );
      try {
        await waitForHostTurns();
        expect(host.querySelector("main")?.textContent).toBe(
          nested ? "innernotes" : "notes",
        );
        expect(errors).toEqual([
          { message: "expected server error", source: "server" },
        ]);
      } finally {
        flushSync(() => root.unmount());
        if (!fullDocument) host.remove();
      }
    } finally {
      result.abort();
      reader.releaseLock();
    }
  },
);
