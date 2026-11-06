import { AsyncLocalStorage } from "node:async_hooks";
import {
  getStartContext,
  type StartStorage,
  startStorageKey,
} from "./start-context.ts";

const globalObject = globalThis as typeof globalThis & {
  [startStorageKey]?: StartStorage;
};

const storage = (globalObject[startStorageKey] ??= new AsyncLocalStorage());

export { getStartContext };

export async function runWithStartContext<T>(
  context: unknown,
  callback: () => T | Promise<T>,
): Promise<T> {
  return storage.run(context, callback);
}
