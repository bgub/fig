import { expect, it } from "vitest";
import { createRendererDataStore, dataResource } from "./data-store.ts";
import { readThenable } from "./thenables.ts";

it("does not retry a failed stale refresh whose rejection reason is undefined", async () => {
  let calls = 0;
  const store = createRendererDataStore<object, null>({
    getLane: () => null,
    schedule: () => undefined,
  });
  const resource = dataResource<[], string>({
    key: () => ["value"],
    load: () => {
      calls += 1;
      return Promise.reject(undefined);
    },
  });
  try {
    store.hydrate([{ key: ["value"], value: "stale" }]);
    await expect(store.refreshData(resource)).resolves.toEqual({
      status: "rejected",
      error: undefined,
      staleValue: "stale",
    });
    expect(store.readData(resource, [], {})).toBe("stale");
    expect(calls).toBe(1);
    store.invalidateData(resource);
    expect(store.readData(resource, [], {})).toBe("stale");
    expect(calls).toBe(2);
  } finally {
    store.dispose();
  }
});

it("retains a thrown thenable failure on subsequent reads", () => {
  const error = new Error("subscription failed");
  const thenable = {
    // oxlint-disable-next-line unicorn/no-thenable
    then() {
      throw error;
    },
  } as PromiseLike<string>;
  expect(() => readThenable(thenable)).toThrow(error);
  expect(() => readThenable(thenable)).toThrow(error);
});

it("keeps the first thenable settlement when it calls both callbacks", () => {
  const thenable = {
    // oxlint-disable-next-line unicorn/no-thenable
    then(resolve: (value: string) => void, reject: (error: Error) => void) {
      resolve("first");
      reject(new Error("late rejection"));
    },
  } as unknown as PromiseLike<string>;
  expect(readThenable(thenable)).toBe("first");
  expect(readThenable(thenable)).toBe("first");
});

it("ignores a thenable throw after fulfillment", () => {
  const thenable = {
    // oxlint-disable-next-line unicorn/no-thenable
    then(resolve: (value: string) => void) {
      resolve("first");
      throw new Error("after settlement");
    },
  } as unknown as PromiseLike<string>;
  expect(readThenable(thenable)).toBe("first");
  expect(readThenable(thenable)).toBe("first");
});

it("keeps a thenable rejection when it later fulfills", () => {
  const error = new Error("first rejection");
  const thenable = {
    // oxlint-disable-next-line unicorn/no-thenable
    then(resolve: (value: string) => void, reject: (error: Error) => void) {
      reject(error);
      resolve("late value");
    },
  } as unknown as PromiseLike<string>;
  expect(() => readThenable(thenable)).toThrow(error);
  expect(() => readThenable(thenable)).toThrow(error);
});
