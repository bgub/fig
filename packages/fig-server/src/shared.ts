import type {
  ActionStateAction,
  ActionStateRunner,
  DependencyList,
  EffectCallback,
  ExternalStoreSubscribe,
  FigContext,
  StableEventArgs,
  StateSetter,
  StartTransition,
} from "@bgub/fig";
import type { DataResource, RenderDispatcher } from "@bgub/fig/internal";

export type ContextValues = Map<FigContext<unknown>, unknown[]>;

interface StaticDispatcherOptions {
  contextValues: ContextValues;
  externalStoreError: string;
  preloadData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): void;
  readData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
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

export function createStaticDispatcher(
  options: StaticDispatcherOptions,
): RenderDispatcher {
  return {
    useState<S>(initialState: S | (() => S)): [S, StateSetter<S>] {
      const value = resolveInitialState(initialState);
      const setState: StateSetter<typeof value> = () => {
        throw new Error(options.updateError);
      };
      return [value, setState];
    },
    useActionState<S, Args extends unknown[]>(
      _action: ActionStateAction<S, Args>,
      initialState: S,
    ): [S, ActionStateRunner<Args>, boolean] {
      const runner: ActionStateRunner<Args> = () => {
        throw new Error(options.updateError);
      };
      return [initialState, runner, false];
    },
    useId(): string {
      return options.useId();
    },
    useDeferredValue<T>(
      value: T,
      _initialValue: T | undefined,
      _hasInitialValue: boolean,
    ): T {
      return value;
    },
    useMemo<T>(calculate: () => T, _deps: DependencyList): T {
      return calculate();
    },
    useTransition(): [boolean, StartTransition] {
      // Server transitions run synchronously to completion; the signal never
      // aborts (there is no supersede/unmount lifecycle during a request).
      const startTransition: StartTransition = (
        callback: (signal: AbortSignal) => void | PromiseLike<void>,
      ) => void callback(new AbortController().signal);
      return [false, startTransition];
    },
    useReactive(_effect: EffectCallback, _deps?: DependencyList): void {},
    useBeforePaint(_effect: EffectCallback, _deps?: DependencyList): void {},
    useBeforeLayout(_effect: EffectCallback, _deps?: DependencyList): void {},
    useSyncExternalStore<T>(
      _subscribe: ExternalStoreSubscribe,
      _getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      if (getServerSnapshot === undefined) {
        throw new Error(options.externalStoreError);
      }

      return getServerSnapshot();
    },
    useStableEvent<Args extends unknown[], Result>(
      _handler: (...args: Args) => Result,
    ): (...args: StableEventArgs<Args>) => Result {
      return (() => {
        throw new Error("Stable events cannot be called during server render.");
      }) as (...args: StableEventArgs<Args>) => Result;
    },
    readContext<T>(context: FigContext<T>): T {
      return readContextValue(options.contextValues, context);
    },
    readData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      args: TArgs,
    ): TValue {
      return options.readData(resource, args);
    },
    preloadData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      args: TArgs,
    ): void {
      options.preloadData(resource, args);
    },
    readPromise<T>(promise: PromiseLike<T>): T {
      return options.readPromise(promise);
    },
  };
}
