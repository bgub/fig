import { describe, expect, it } from "vitest";
import { getStartContext, runWithStartContext } from "./storage-context.ts";

describe("Start storage context", () => {
  it("preserves request state across async server work", async () => {
    const context = { requestId: "one" };

    await runWithStartContext(context, async () => {
      await Promise.resolve();
      expect(getStartContext()).toBe(context);
    });

    expect(getStartContext({ throwIfNotFound: false })).toBeUndefined();
  });
});
