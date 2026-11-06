import { describe, expect, it, vi } from "vitest";
import { getStartContext, runWithStartContext } from "./storage-context.ts";

describe("Start storage context", () => {
  it("isolates interleaved async request contexts", async () => {
    const first = { requestId: "first" };
    const second = { requestId: "second" };
    const readAfterYield = (context: object) =>
      runWithStartContext(context, async () => {
        await Promise.resolve();
        return getStartContext();
      });

    await expect(
      Promise.all([readAfterYield(first), readAfterYield(second)]),
    ).resolves.toEqual([first, second]);
    expect(getStartContext({ throwIfNotFound: false })).toBeUndefined();
  });
});

it("restores the outer context after a nested rejection", async () => {
  const outer = { requestId: "outer" };
  await runWithStartContext(outer, async () => {
    await expect(
      runWithStartContext({ requestId: "inner" }, async () => {
        await Promise.resolve();
        throw new Error("nested failure");
      }),
    ).rejects.toThrow("nested failure");
    expect(getStartContext()).toBe(outer);
  });
  expect(getStartContext({ throwIfNotFound: false })).toBeUndefined();
});

it("retains request isolation through delayed stream production", async () => {
  const render = (requestId: string) =>
    runWithStartContext(
      { requestId },
      () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              await new Promise((resolve) =>
                setTimeout(resolve, requestId === "first" ? 10 : 0),
              );
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify(getStartContext())),
              );
              controller.close();
            },
          }),
        ),
    );
  const responses = await Promise.all([render("first"), render("second")]);
  expect(
    await Promise.all(responses.map((response) => response.json())),
  ).toEqual([{ requestId: "first" }, { requestId: "second" }]);
  expect(getStartContext({ throwIfNotFound: false })).toBeUndefined();
});

it("shares request storage across module instances", async () => {
  vi.resetModules();
  const other = await import("./storage-context.ts");
  const context = { requestId: "shared" };
  await runWithStartContext(context, async () => {
    await Promise.resolve();
    expect(other.getStartContext()).toBe(context);
  });
  await other.runWithStartContext(context, async () => {
    await Promise.resolve();
    expect(getStartContext()).toBe(context);
  });
});
