import { describe, expect, it } from "vitest";
import { useReadableStore } from "./store.ts";

describe("useReadableStore", () => {
  it("reads non-reactive server stores without entering the hook path", () => {
    expect(useReadableStore({ get: () => 21 }, (value) => value * 2)).toBe(42);
  });
});
