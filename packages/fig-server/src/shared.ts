import type { Dispatch, FigContext, SetStateAction } from "@bgub/fig";
import type { RenderDispatcher } from "@bgub/fig/internal";

export type ContextValues = Map<FigContext<unknown>, unknown[]>;
export type Thenable<T = unknown> = PromiseLike<T> & object;

type ThenableRecord<T> = {
  reason?: unknown;
  status: "pending" | "fulfilled" | "rejected";
  value?: T;
};

interface StaticDispatcherOptions {
  contextValues: ContextValues;
  externalStoreError: string;
  readPromise<T>(promise: PromiseLike<T>): T;
  updateError: string;
  useId(): string;
}

const thenableRecords = new WeakMap<object, ThenableRecord<unknown>>();

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

export function readContextValue<T>(
  values: ContextValues,
  context: FigContext<T>,
): T {
  const stack = values.get(context as FigContext<unknown>);
  if (stack !== undefined && stack.length > 0) {
    return stack[stack.length - 1] as T;
  }

  return context.defaultValue;
}

export function cloneContextValues(values: ContextValues): ContextValues {
  const clone: ContextValues = new Map();
  for (const [context, stack] of values) clone.set(context, [...stack]);
  return clone;
}

export function readThenable<T>(thenable: PromiseLike<T>): T {
  const key = thenable as Thenable<T>;
  let record = thenableRecords.get(key) as ThenableRecord<T> | undefined;

  if (record === undefined) {
    const pendingRecord: ThenableRecord<T> = { status: "pending" };
    record = pendingRecord;
    thenableRecords.set(key, pendingRecord);
    thenable.then(
      (value) => {
        pendingRecord.status = "fulfilled";
        pendingRecord.value = value;
      },
      (reason: unknown) => {
        pendingRecord.status = "rejected";
        pendingRecord.reason = reason;
      },
    );
  }

  if (record.status === "fulfilled") return record.value as T;
  if (record.status === "rejected") throw record.reason;
  throw key;
}

export function isThenable(value: unknown): value is Thenable {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }

  return typeof (value as PromiseLike<unknown>).then === "function";
}

export function resolveInitialState<S>(initialState: S | (() => S)): S {
  return typeof initialState === "function"
    ? (initialState as () => S)()
    : initialState;
}

export function noopEffect(): void {}

export function createStaticDispatcher(
  options: StaticDispatcherOptions,
): RenderDispatcher {
  return {
    useState(initialState) {
      const value = resolveInitialState(initialState);
      const dispatch: Dispatch<SetStateAction<typeof value>> = () => {
        throw new Error(options.updateError);
      };
      return [value, dispatch];
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
      return [false, (callback) => callback()];
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
    useReactiveEvent() {
      return () => {
        throw new Error(
          "Reactive events cannot be called during server render.",
        );
      };
    },
    readContext(context) {
      return readContextValue(options.contextValues, context);
    },
    readPromise(promise) {
      return options.readPromise(promise);
    },
  };
}

export function describeInvalidChild(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;

  const keys = Object.keys(value);
  return keys.length === 0 ? "object" : `object with keys ${keys.join(", ")}`;
}
