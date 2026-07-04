import type { FigContext, StateSetter } from "@bgub/fig";
import type { FigDataResource, RenderDispatcher } from "@bgub/fig/internal";

export type ContextValues = Map<FigContext<unknown>, unknown[]>;

interface StaticDispatcherOptions {
  contextValues: ContextValues;
  externalStoreError: string;
  preloadData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: FigDataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
  ): void;
  readData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: FigDataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
  ): TValue;
  readPromise<T>(promise: PromiseLike<T>): T;
  updateError: string;
  useId(): string;
}

function contextStack(
  values: ContextValues,
  context: FigContext<unknown>,
): unknown[] {
  let stack = values.get(context);

  if (stack === undefined) {
    stack = [];
    values.set(context, stack);
  }

  return stack;
}

export function withContextValue<T>(
  values: ContextValues,
  context: FigContext<unknown>,
  value: unknown,
  callback: () => T,
): T {
  const stack = contextStack(values, context);
  stack.push(value);

  try {
    return callback();
  } finally {
    stack.pop();
  }
}

function readContextValue<T>(values: ContextValues, context: FigContext<T>): T {
  const stack = values.get(context as FigContext<unknown>);
  if (stack !== undefined && stack.length > 0) {
    return stack[stack.length - 1] as T;
  }

  return context.defaultValue;
}

export interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => undefined;
  let reject: Deferred<T>["reject"] = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

export function cloneContextValues(values: ContextValues): ContextValues {
  const clone: ContextValues = new Map();
  for (const [context, stack] of values) clone.set(context, [...stack]);
  return clone;
}

function resolveInitialState<S>(initialState: S | (() => S)): S {
  return typeof initialState === "function"
    ? (initialState as () => S)()
    : initialState;
}

function noopEffect(): void {}

export function createStaticDispatcher(
  options: StaticDispatcherOptions,
): RenderDispatcher {
  return {
    useState(initialState) {
      const value = resolveInitialState(initialState);
      const setState: StateSetter<typeof value> = () => {
        throw new Error(options.updateError);
      };
      return [value, setState];
    },
    useActionState(_action, initialState) {
      return [
        initialState,
        () => {
          throw new Error(options.updateError);
        },
        false,
      ];
    },
    useId() {
      return options.useId();
    },
    useLaggedValue(value) {
      return value;
    },
    useMemo(calculate) {
      return calculate();
    },
    useTransition() {
      return [false, (callback) => void callback()];
    },
    useReactive: noopEffect,
    useBeforePaint: noopEffect,
    useBeforeLayout: noopEffect,
    useExternalStore(_subscribe, _getSnapshot, getServerSnapshot) {
      if (getServerSnapshot === undefined) {
        throw new Error(options.externalStoreError);
      }

      return getServerSnapshot();
    },
    useStableEvent() {
      return () => {
        throw new Error("Stable events cannot be called during server render.");
      };
    },
    readContext(context) {
      return readContextValue(options.contextValues, context);
    },
    readData(resource, args) {
      return options.readData(resource, args);
    },
    preloadData(resource, args) {
      options.preloadData(resource, args);
    },
    readPromise(promise) {
      return options.readPromise(promise);
    },
  };
}
