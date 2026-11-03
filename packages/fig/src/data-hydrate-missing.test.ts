import { describe, expect, it } from "vitest";
import { createDataStore, dataResource } from "./index.ts";
import type { FigDataStore } from "./internal.ts";

describe("hydrateMissing", () => {
  it("fills absent and pending entries but keeps values the store holds", async () => {
    let resolvePending = (_value: string): void => undefined;
    const pendingResource = dataResource<[], string>({
      key: () => ["missing-pending"],
      load: () =>
        new Promise<string>((resolve) => {
          resolvePending = resolve;
        }),
    });
    const controller = createDataStore({
      initialData: [{ key: ["missing-held"], value: "client" }],
    });
    const store = controller as unknown as FigDataStore;
    const pending = controller.ensureData(pendingResource);

    store.hydrateMissing([
      { key: ["missing-absent"], value: "streamed" },
      { key: ["missing-pending"], value: "streamed" },
      { key: ["missing-held"], value: "streamed" },
    ]);
    resolvePending("loaded");

    await expect(pending).resolves.toBe("streamed");
    expect(controller.snapshot()).toEqual(
      expect.arrayContaining([
        { key: ["missing-absent"], value: "streamed" },
        { key: ["missing-pending"], value: "streamed" },
        { key: ["missing-held"], value: "client" },
      ]),
    );
  });
});
