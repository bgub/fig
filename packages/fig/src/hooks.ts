import type { FigContext } from "./context.ts";
import type { DataResource, FigDataStore } from "./data.ts";
import { resolveCurrentDataStore } from "./data.ts";
import type { TransitionOptions } from "./transition.ts";

// The useState updater: accepts the next state, or an updater function of
// the previous state for stale-closure safety.
export type StateSetter<S> = (next: S | ((previous: S) => S)) => void;
export type ExternalStoreSubscribe = (callback: () => void) => () => void;
// Fig appends the AbortSignal after the runner's args (the data-loader
// shape). The signal aborts when a newer run supersedes this one, when the
// owning component unmounts, and when an enclosing Activity hides.
export type ActionStateAction<S, Args extends unknown[]> = (
  previousState: S,
  ...argsAndSignal: [...Args, AbortSignal]
) => S | PromiseLike<S>;
export type ActionStateRunner<Args extends unknown[]> = (...args: Args) => void;

/**
 * Runs state updates scheduled by `callback` at transition priority. If
 * `callback` returns a thenable, `useTransition` keeps `isPending` true until
 * it settles and updates after an `await` remain in the transition priority
 * scope.
 *
 * The callback receives an `AbortSignal` that aborts when a newer transition
 * starts from the same hook, when the owning component unmounts, and when an
 * enclosing Activity hides. Each `useTransition` hook is one cancellation
 * domain — use separate hooks for independently cancellable workflows. An
 * aborted run is retired: its pending slot is released immediately and its
 * settlement (including an aborted fetch's rejection) is inert.
 */
export type StartTransition = (
  callback: (signal: AbortSignal) => void | PromiseLike<void>,
  options?: TransitionOptions,
) => void;
type Callback = (...args: never[]) => unknown;

export interface RenderDispatcher {
  useState<S>(initialState: S | (() => S)): [S, StateSetter<S>];
  useActionState<S, Args extends unknown[]>(
    action: ActionStateAction<S, Args>,
    initialState: S,
  ): [S, ActionStateRunner<Args>, boolean];
  useId(): string;
  useDeferredValue<T>(
    value: T,
    initialValue: T | undefined,
    hasInitialValue: boolean,
  ): T;
  useMemo<T>(calculate: () => T, deps: DependencyList): T;
  useTransition(): [boolean, StartTransition];
  useReactive(effect: EffectCallback, deps?: DependencyList): void;
  useBeforePaint(effect: EffectCallback, deps?: DependencyList): void;
  useBeforeLayout(effect: EffectCallback, deps?: DependencyList): void;
  useSyncExternalStore<T>(
    subscribe: ExternalStoreSubscribe,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
  useStableEvent<Args extends unknown[], Result>(
    handler: (...args: Args) => Result,
  ): (...args: StableEventCallerArgs<Args>) => Result;
  readContext<T>(context: FigContext<T>): T;
  readData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): TValue;
  preloadData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): void;
  readPromise<T>(promise: PromiseLike<T>): T;
}

export type EffectCallback = (signal: AbortSignal) => undefined;
export type DependencyList = readonly unknown[];

export type StableEventCallerArgs<Args extends unknown[]> = Args extends [
  ...infer CallerArgs,
  AbortSignal,
]
  ? CallerArgs
  : Args;

// Fig appends the AbortSignal when invoking the handler; callers never pass
// it, so a declared trailing signal is stripped from the callable signature.
let currentDispatcher: RenderDispatcher | null = null;

export function useState<S>(initialState: S | (() => S)): [S, StateSetter<S>] {
  return resolveDispatcher().useState(initialState);
}

/**
 * Tracks state returned by a client-side action. The action receives the
 * previous committed state first, then the runner's arguments, then an
 * `AbortSignal` Fig appends (declare the trailing signal parameter — it also
 * drives `Args` inference). Async actions run in a transition priority scope
 * and keep `isPending` true until they settle.
 *
 * Runs are last-run-wins: starting a new run aborts the previous one's
 * signal and retires it — a retired run's settlement (value or rejection)
 * never touches state or pending. The signal also aborts on unmount and
 * when an enclosing Activity hides.
 */
export function useActionState<S, Args extends unknown[]>(
  action: ActionStateAction<S, Args>,
  initialState: S,
): [S, ActionStateRunner<Args>, boolean] {
  return resolveDispatcher().useActionState(action, initialState);
}

export function useId(): string {
  return resolveDispatcher().useId();
}

export function useDeferredValue<T>(value: T, initialValue?: T): T {
  return resolveDispatcher().useDeferredValue(
    value,
    initialValue,
    arguments.length > 1,
  );
}

export function useMemo<T>(calculate: () => T, deps: DependencyList): T {
  return resolveDispatcher().useMemo(calculate, deps);
}

export function useTransition(): [boolean, StartTransition] {
  return resolveDispatcher().useTransition();
}

export function useCallback<T extends Callback>(
  callback: T,
  deps: DependencyList,
): T {
  return resolveDispatcher().useMemo(() => callback, deps);
}

export function useReactive(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  resolveDispatcher().useReactive(effect, deps);
}

export function useBeforePaint(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  resolveDispatcher().useBeforePaint(effect, deps);
}

export function useBeforeLayout(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  resolveDispatcher().useBeforeLayout(effect, deps);
}

export function useSyncExternalStore<T>(
  subscribe: ExternalStoreSubscribe,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  return resolveDispatcher().useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
}

export function useStableEvent<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: StableEventCallerArgs<Args>) => Result {
  return resolveDispatcher().useStableEvent(handler);
}

export function readContext<T>(context: FigContext<T>): T {
  return resolveDispatcher(
    "readContext can only be called while rendering a component.",
  ).readContext(context);
}

export function readPromise<T>(promise: PromiseLike<T>): T {
  return resolveDispatcher(
    "readPromise can only be called while rendering a component.",
  ).readPromise(promise);
}

export function readData<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): TValue {
  return resolveDispatcher(
    "readData can only be called while rendering a component.",
  ).readData(resource, args);
}

export function preloadData<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): void {
  if (currentDispatcher !== null) {
    currentDispatcher.preloadData(resource, args);
    return;
  }

  resolveDataStore().preloadData(resource, ...args);
}

export function setCurrentDispatcher(
  dispatcher: RenderDispatcher | null,
): RenderDispatcher | null {
  const previousDispatcher = currentDispatcher;
  currentDispatcher = dispatcher;
  return previousDispatcher;
}

function resolveDispatcher(
  message = "Hooks can only be called while rendering a component.",
): RenderDispatcher {
  if (currentDispatcher === null) {
    throw new Error(message);
  }

  return currentDispatcher;
}

function resolveDataStore(): FigDataStore {
  return resolveCurrentDataStore(
    "No ambient Fig data store. Data APIs work synchronously during render, " +
      "event handlers, actions, and effects — not after an await. Capture " +
      "readDataStore() (or root.data) synchronously and call the handle " +
      "instead.",
  );
}
