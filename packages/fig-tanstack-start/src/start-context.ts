export interface StartStorage {
  getStore(): unknown;
  run<T>(context: unknown, callback: () => T): T;
}

export const startStorageKey = Symbol.for(
  "tanstack-start:start-storage-context",
);

const globalObject = globalThis as typeof globalThis & {
  [startStorageKey]?: StartStorage;
};

export function getStartContext(options?: {
  throwIfNotFound?: boolean;
}): unknown {
  const context = globalObject[startStorageKey]?.getStore();
  if (context === undefined && options?.throwIfNotFound !== false) {
    throw new Error(
      "No TanStack Start context is available outside the server runtime.",
    );
  }
  return context;
}
