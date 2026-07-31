import type {
  ActionStateAction,
  ActionStateRunner,
  DependencyList,
  ExternalStoreSubscribe,
  FigContext,
  StateSetter,
  StartTransition,
} from "@bgub/fig";
import type {
  DataResource,
  RenderDispatcher,
  StableEventCallerArgs,
} from "@bgub/fig/internal";
import { escapeAttribute } from "./escaping.ts";
import type { ServerErrorPayload, ServerRenderOptions } from "./types.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export type ContextValues = Map<FigContext<unknown>, unknown[]>;

export const STREAMED_METADATA_ATTRIBUTE = "data-fig-streamed-metadata";

export function noLane(): null {
  return null;
}

export function noop(): void {}

export interface StackFrame {
  name: string;
  parent: StackFrame | null;
}

interface StaticDispatcherOptions {
  contextValues: ContextValues;
  externalStoreError: string;
  preloadData<TArgs extends unknown[], TValue>(
    this: void,
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): void;
  readData<TArgs extends unknown[], TValue>(
    this: void,
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): TValue;
  readPromise<T>(this: void, promise: PromiseLike<T>): T;
  updateError: string;
  useId(this: void): string;
}

export function withContextValue<T>(
  values: ContextValues,
  context: FigContext<unknown>,
  value: unknown,
  callback: () => T,
): T {
  let stack = values.get(context);
  if (stack === undefined) {
    stack = [];
    values.set(context, stack);
  }
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
  let resolve: Deferred<T>["resolve"] | null = null;
  let reject: Deferred<T>["reject"] | null = null;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  if (resolve === null || reject === null) {
    throw new Error("Promise executor did not initialize its deferred.");
  }
  return { promise, reject, resolve };
}

export function cloneContextValues(values: ContextValues): ContextValues {
  const clone: ContextValues = new Map();
  for (const [context, stack] of values) clone.set(context, [...stack]);
  return clone;
}

// Encoded bytes a render result stream's internal queue holds before flushing
// pauses (resumed by consumer pulls). Shared by the HTML and payload
// renderers. Large enough that a healthy consumer never blocks a flush; small
// enough to bound per-connection buffering when the consumer stalls.
// Rendering itself never pauses — only writing to the stream does.
const DEFAULT_STREAM_HIGH_WATER_MARK = 65536;

// 0 would deadlock: desiredSize never goes positive, and read requests alone
// do not make it so. 1 byte is the honest pure-pull minimum.
export function streamHighWaterMark(option: number | undefined): number {
  return Math.max(1, option ?? DEFAULT_STREAM_HIGH_WATER_MARK);
}

// Blocked means the stream's internal queue is at or past its high-water
// mark; completed work then waits un-enqueued until the consumer pulls.
// desiredSize is null on an errored stream — never blocked, because fatal
// paths close the request before any further writes.
export function streamFlowBlocked(
  controller: ReadableStreamDefaultController<Uint8Array> | null,
): boolean {
  const desiredSize = controller?.desiredSize;
  return typeof desiredSize === "number" && desiredSize <= 0;
}

export function createStaticDispatcher(
  options: StaticDispatcherOptions,
): RenderDispatcher {
  const rejectUpdate = (..._args: unknown[]): never => {
    throw new Error(options.updateError);
  };

  return {
    useState<S>(initialState: S | (() => S)): [S, StateSetter<S>] {
      const value =
        typeof initialState === "function"
          ? (initialState as () => S)()
          : initialState;
      return [value, rejectUpdate];
    },
    useActionState<S, Args extends unknown[]>(
      _action: ActionStateAction<S, Args>,
      initialState: S,
    ): [S, ActionStateRunner<Args>, boolean] {
      return [initialState, rejectUpdate, false];
    },
    useId: options.useId,
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
      return [false, startServerTransition];
    },
    useReactive: noop,
    useBeforePaint: noop,
    useBeforeLayout: noop,
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
    ): (...args: StableEventCallerArgs<Args>) => Result {
      return rejectStableEventCall;
    },
    readContext<T>(context: FigContext<T>): T {
      return readContextValue(options.contextValues, context);
    },
    readData: options.readData,
    preloadData: options.preloadData,
    readPromise: options.readPromise,
  };
}

// Server transitions run synchronously to completion; the signal never
// aborts because there is no supersede/unmount lifecycle during a request.
function startServerTransition(
  callback: (signal: AbortSignal) => void | PromiseLike<void>,
): void {
  void callback(new AbortController().signal);
}

function rejectStableEventCall<Args extends unknown[], Result>(
  ..._args: StableEventCallerArgs<Args>
): Result {
  throw new Error("Stable events cannot be called during server render.");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function componentStack(stack: StackFrame | null): string {
  const frames: string[] = [];
  for (let frame = stack; frame !== null; frame = frame.parent) {
    frames.push(`    at ${frame.name}`);
  }
  return frames.length === 0 ? "" : `\n${frames.join("\n")}`;
}

export function serverErrorPayload(
  error: unknown,
  stack: StackFrame | null,
  onError: ServerRenderOptions["onError"],
): ServerErrorPayload {
  if (onError === undefined) {
    return __DEV__ ? { message: errorMessage(error) } : {};
  }
  try {
    return onError(error, { componentStack: componentStack(stack) }) ?? {};
  } catch {
    return {};
  }
}

export function nonceAttribute(nonce: string | undefined): string {
  return nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
}
