import {
  createNonReactiveMutableStore,
  createNonReactiveReadonlyStore,
  type GetStoreConfig,
} from "@tanstack/router-core";
import { batch, createAtom, type Readable } from "@tanstack/store";

declare module "@tanstack/router-core" {
  interface RouterReadableStore<TValue> extends Readable<TValue> {}
}

export const getStoreConfig: GetStoreConfig = (options) => {
  if (options.isServer ?? typeof document === "undefined") {
    return {
      batch: (callback) => callback(),
      createMutableStore: createNonReactiveMutableStore,
      createReadonlyStore: createNonReactiveReadonlyStore,
    };
  }

  return {
    batch,
    createMutableStore: createAtom,
    createReadonlyStore: createAtom,
  };
};
