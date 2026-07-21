import {
  getStartContext,
  type StartStorage,
  startStorageKey,
} from "./start-context.ts";

const globalObject = globalThis as typeof globalThis & {
  [startStorageKey]?: StartStorage;
};

const storage = (globalObject[startStorageKey] ??= await createStorage());

export { getStartContext };

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
