import { expect, it } from "vitest";
import {
  getStartContext,
  runWithStartContext,
} from "./storage-context-client.ts";
import { startStorageKey } from "./start-context.ts";

it("does not install request storage or retain browser callback context", async () => {
  expect(Reflect.has(globalThis, startStorageKey)).toBe(false);
  expect(
    await runWithStartContext({}, async () => {
      await Promise.resolve();
      expect(getStartContext({ throwIfNotFound: false })).toBeUndefined();
      return "result";
    }),
  ).toBe("result");
  expect(() => getStartContext()).toThrow("outside the server runtime");
  expect(Reflect.has(globalThis, startStorageKey)).toBe(false);
});
