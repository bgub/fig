import { describe, expect, it } from "vitest";
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
