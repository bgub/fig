export interface StartStorage {
  getStore(): unknown;
  run<T>(context: unknown, callback: () => T): T;
}

export const startStorageKey = Symbol.for(
  "tanstack-start:start-storage-context",
);

export function getStartContext(options?: {
  throwIfNotFound?: boolean;
}): unknown {
  const storage = Reflect.get(globalThis, startStorageKey);
  let context: unknown;
  if (typeof storage === "object" && storage !== null) {
    const getStore = Reflect.get(storage, "getStore");
    if (typeof getStore === "function") {
      context = Reflect.apply(getStore, storage, []);
    }
  }
  if (context === undefined && options?.throwIfNotFound !== false) {
    throw new Error(
      "No TanStack Start context is available outside the server runtime.",
    );
  }
  return context;
}
