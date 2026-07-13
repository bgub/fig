// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  getPayloadFrameStream,
  payloadFrameBootstrapCode,
  payloadFrameBootstrapScript,
  payloadFrameScript,
} from "./payload-frames.ts";

// Each test uses its own global name: the queue global outlives a test in
// the shared happy-dom window.
let nextGlobal = 0;
function uniqueGlobalName(): string {
  nextGlobal += 1;
  return `__figFrameTest${nextGlobal}`;
}

function runInlineScript(markup: string): void {
  const source = /<script[^>]*>([\s\S]*?)<\/script>/.exec(markup);
  if (source === null) throw new Error("No script content in markup.");
  // Classic inline scripts run against the global scope; the bootstrap IIFE
  // assigns through globalThis explicitly, so Function-scope evaluation is
  // equivalent for it.
  // oxlint-disable-next-line typescript-eslint/no-implied-eval
  new Function(source[1] ?? "")();
}

describe("payload frame transport", () => {
  it("installs an idempotent queue global with replaying subscriptions", () => {
    const globalName = uniqueGlobalName();
    runInlineScript(payloadFrameBootstrapScript({ globalName }));
    const stream = (globalThis as Record<string, unknown>)[globalName] as {
      q: unknown[];
      p(frame: unknown): void;
      s(listener: (frame: unknown) => void): () => void;
    };

    stream.p("one");
    const seen: unknown[] = [];
    const unsubscribe = stream.s((frame) => seen.push(frame));
    expect(seen).toEqual(["one"]);

    stream.p("two");
    expect(seen).toEqual(["one", "two"]);
    expect(stream.q).toEqual(["one", "two"]);

    unsubscribe();
    stream.p("three");
    expect(seen).toEqual(["one", "two"]);

    // Re-running the bootstrap must not clobber the queue.
    runInlineScript(payloadFrameBootstrapScript({ globalName }));
    expect(
      ((globalThis as Record<string, unknown>)[globalName] as { q: unknown[] })
        .q,
    ).toEqual(["one", "two", "three"]);
  });

  it("emits parse-safe carrier and push scripts with nonces", () => {
    const globalName = uniqueGlobalName();
    const markup = payloadFrameScript(
      { chunk: "</script><b>bad</b>", id: "seg" },
      { attribute: "data-test-frame", globalName, nonce: "abc" },
    );

    // The carrier JSON escapes `<`, so a chunk containing a closing script
    // tag cannot terminate the carrier early.
    expect(markup).not.toContain("</script><b>");
    expect(markup).toContain('type="application/json" data-test-frame=""');
    expect((markup.match(/ nonce="abc"/g) ?? []).length).toBe(2);
    expect(markup).toContain(`globalThis.${globalName}.p(JSON.parse(`);

    expect(payloadFrameBootstrapCode({ globalName })).not.toContain("<script");
  });

  it("rejects global names and attributes that would inject into emitted code", () => {
    // globalName lands in emitted JS as a property expression; attribute in
    // raw markup and a CSS selector. Both validate instead of escaping.
    expect(() =>
      payloadFrameBootstrapCode({ globalName: "a;fetch('/x')//" }),
    ).toThrow("globalName must be a JavaScript identifier");
    expect(() =>
      payloadFrameScript("chunk", { globalName: "bad name" }),
    ).toThrow("globalName must be a JavaScript identifier");
    expect(() =>
      payloadFrameScript("chunk", { attribute: 'x="1" onload="hack()"' }),
    ).toThrow("attribute must be a letter followed by");
    expect(() =>
      payloadFrameScript("chunk", { attribute: "data-fine-name" }),
    ).not.toThrow();
  });

  it("pushes document frames through the installed global", () => {
    const globalName = uniqueGlobalName();
    const attribute = "data-test-live-frame";
    runInlineScript(payloadFrameBootstrapScript({ globalName }));

    // Simulate the browser parsing an interleaved frame: the carrier lands in
    // the DOM and the push script runs against document.currentScript. The
    // test drives the push manually since happy-dom will not execute an
    // injected inline script here.
    const markup = payloadFrameScript(
      { chunk: "row", id: "seg" },
      { attribute, globalName },
    );
    document.body.insertAdjacentHTML("beforeend", markup);
    const carrier = document.querySelector(`script[${attribute}]`);
    expect(carrier).not.toBeNull();

    const stream = getPayloadFrameStream<{ chunk: string; id: string }>({
      attribute,
      globalName,
    });
    // The getter replayed the parsed-but-unpushed carrier into the queue.
    expect(stream.q).toEqual([{ chunk: "row", id: "seg" }]);

    // A second call dedupes: the same document frame is not replayed twice.
    expect(getPayloadFrameStream({ attribute, globalName }).q).toEqual([
      { chunk: "row", id: "seg" },
    ]);
  });

  it("creates the global from document frames when the bootstrap never ran", () => {
    const globalName = uniqueGlobalName();
    const attribute = "data-test-orphan-frame";
    document.body.insertAdjacentHTML(
      "beforeend",
      payloadFrameScript("chunk-a", { attribute, globalName }),
    );

    const stream = getPayloadFrameStream<string>({ attribute, globalName });
    expect(stream.q).toEqual(["chunk-a"]);
    expect((globalThis as Record<string, unknown>)[globalName]).toBe(stream);

    const seen: string[] = [];
    stream.s((frame) => seen.push(frame));
    expect(seen).toEqual(["chunk-a"]);
  });
});
