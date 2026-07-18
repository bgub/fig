interface StartStorage {
  getStore(): unknown;
  run<T>(context: unknown, callback: () => T): T;
}

const storageKey = Symbol.for("tanstack-start:start-storage-context");
const globalObject = globalThis as typeof globalThis & {
  [storageKey]?: StartStorage;
};

const storage = (globalObject[storageKey] ??= await createStorage());

export function getStartContext(options?: {
  throwIfNotFound?: boolean;
}): unknown {
  const context = storage.getStore();
  if (context === undefined && options?.throwIfNotFound !== false) {
    throw new Error(
      "No TanStack Start context is available outside the server runtime.",
    );
  }
  return context;
}

export async function runWithStartContext<T>(
  context: unknown,
  callback: () => T | Promise<T>,
): Promise<T> {
  return await storage.run(context, callback);
}

async function createStorage(): Promise<StartStorage> {
  if (typeof document === "undefined") {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    return new AsyncLocalStorage();
  }
  return {
    getStore: () => undefined,
    run: (_context, callback) => callback(),
  };
}
