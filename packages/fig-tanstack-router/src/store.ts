import { useCallback, useMemo, useSyncExternalStore } from "@bgub/fig";
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

function selectStoreValue<TValue>(value: TValue): TValue {
  return value;
}

type ReadableRouterStore<TValue> = {
  get: () => TValue;
  subscribe?: Readable<TValue>["subscribe"];
};

function doNothing(): void {}

export function useReadableStore<TValue, TSelected = TValue>(
  store: ReadableRouterStore<TValue>,
  select: (value: TValue) => TSelected = selectStoreValue as (
    value: TValue,
  ) => TSelected,
  equal: (previous: TSelected, next: TSelected) => boolean = Object.is,
): TSelected {
  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribe?.(onChange).unsubscribe ?? doNothing,
    [store],
  );
  const getSnapshot = useMemo(() => {
    let source: TValue | undefined;
    let selected: TSelected;
    let initialized = false;
    return () => {
      const nextSource = store.get();
      if (initialized && Object.is(source, nextSource)) return selected;
      const nextSelected = select(nextSource);
      source = nextSource;
      if (initialized && equal(selected, nextSelected)) return selected;
      selected = nextSelected;
      initialized = true;
      return selected;
    };
  }, [equal, select, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
