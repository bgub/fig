import { createElement, type FigNode, readPromise, Suspense } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { renderToStream } from "./index.ts";
import { type Deferred, deferred } from "./shared.ts";
import { readStream } from "./test-utils.ts";

// Streaming flow control: rendering never pauses, but op-writing stops at the
// stream's high-water mark and resumes on consumer pulls. A 1-byte mark makes
// every flush pass block immediately, so these tests exercise the pull path
// on every boundary.

function Value(props: { promise: Promise<string> }): FigNode {
  return createElement("span", null, readPromise(props.promise));
}

function suspendingTree(pendings: Array<Deferred<string>>): FigNode {
  return createElement(
    "main",
    null,
    ...pendings.map((pending, index) =>
      createElement(
        Suspense,
        { fallback: createElement("em", null, `Loading ${index}`) },
        createElement(Value, { promise: pending.promise }),
        " tail",
      ),
    ),
  );
}

async function nextMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function readStreamSlowly(
  stream: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(decoder.decode(value, { stream: true }));
    await nextMacrotask();
  }
}

describe("streaming flow control", () => {
  it("coalesces completions that settle while blocked into single-piece reveals", async () => {
    const pendings = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ];
    const result = renderToStream(suspendingTree(pendings), {
      highWaterMark: 1,
    });
    await result.shellReady;
    pendings.forEach((pending, index) => pending.resolve(`Ready ${index}`));
    await result.allReady;

    const html = (await readStreamSlowly(result.stream)).join("");

    // Blocked flushing defers the outline-vs-inline choice, so work that
    // settles while blocked ships as one staged piece per boundary with one
    // reveal op — no partial placeholder fills (an unthrottled render of the
    // same tree emits `.s(` fills for the suspended children).
    for (const index of [0, 1, 2]) {
      expect(html).toContain(
        `<div hidden id="s-${index}"><span>Ready ${index}</span> tail</div>`,
      );
      expect(html).toContain(`.c("b-${index}","s-${index}")`);
    }
    expect(html).not.toContain(".s(");
  });

  it("resolves allReady unread, then flushes one blocked boundary per pull", async () => {
    const pendings = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ];
    const result = renderToStream(suspendingTree(pendings), {
      highWaterMark: 1,
    });

    for (const pending of pendings) pending.resolve("Ready");
    // Readiness is task-driven, so it must settle with nothing reading.
    await result.allReady;

    const chunks = await readStreamSlowly(result.stream);

    // One shell chunk, then exactly one boundary reveal per pull-driven pass.
    expect(chunks.length).toBe(4);
    for (const chunk of chunks.slice(1)) {
      expect((chunk.match(/\.c\(/g) ?? []).length).toBe(1);
    }

    // No boundary flushed twice under synchronous pull reentrancy.
    const html = chunks.join("");
    for (const id of ["s-0", "s-1", "s-2"]) {
      expect((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length).toBe(1);
    }
  });

  it("keeps every chunk ending on complete markup under backpressure", async () => {
    const pendings = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ];
    const result = renderToStream(suspendingTree(pendings), {
      highWaterMark: 1,
    });
    await result.shellReady;
    pendings.forEach((pending, index) => pending.resolve(`Ready ${index}`));
    await result.allReady;

    for (const chunk of await readStreamSlowly(result.stream)) {
      // A chunk may end in document text, but never inside an open tag.
      expect(chunk.lastIndexOf("<")).toBeLessThanOrEqual(
        chunk.lastIndexOf(">"),
      );
    }
  });

  it("flushes abort ops through later pulls while blocked", async () => {
    const pendings = [deferred<string>(), deferred<string>()];
    const result = renderToStream(suspendingTree(pendings), {
      highWaterMark: 1,
    });
    await result.shellReady;

    pendings[0].resolve("First");
    await nextMacrotask();
    result.abort(new Error("stop"));
    await result.allReady;

    const html = (await readStreamSlowly(result.stream)).join("");
    expect((html.match(/\.c\(/g) ?? []).length).toBe(1);
    expect((html.match(/\.x\(/g) ?? []).length).toBe(1);
    expect(html).toContain("First");
  });

  it("aborts the render when the consumer cancels mid-stream", async () => {
    const pending = deferred<string>();
    const result = renderToStream(suspendingTree([pending]), {
      highWaterMark: 1,
    });
    await result.shellReady;

    const reader = result.stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);

    await reader.cancel(new Error("consumer gone"));
    await result.allReady;

    // A late resolution must be ignored, not crash into a cancelled stream.
    pending.resolve("late");
    await nextMacrotask();
  });

  it("clamps a zero high-water mark instead of deadlocking", async () => {
    const pending = deferred<string>();
    const result = renderToStream(suspendingTree([pending]), {
      highWaterMark: 0,
    });
    await result.shellReady;
    pending.resolve("Ready");
    await result.allReady;

    const html = await readStream(result.stream);
    expect(html).toContain("Ready");
    expect(html).toContain(".c(");
  });
});
