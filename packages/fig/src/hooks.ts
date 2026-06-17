import type { FigContext } from "./context.ts";

export type SetStateAction<S> = S | ((previousState: S) => S);
export type Dispatch<A> = (action: A) => void;
export type ExternalStoreSubscribe = (callback: () => void) => () => void;
export type ActionStateAction<S, Args extends unknown[]> = (
  previousState: S,
  ...args: Args
) => S | PromiseLike<S>;
export type ActionStateDispatch<Args extends unknown[]> = (
  ...args: Args
) => void;

/**
 * Runs state updates scheduled by `callback` at transition priority. If
 * `callback` returns a thenable, `useTransition` keeps `isPending` true until
 * it settles and updates after an `await` remain in the transition priority
 * scope.
 */
export type StartTransition = (
  callback: () => void | PromiseLike<void>,
) => void;
type Callback = (...args: never[]) => unknown;

export interface RenderDispatcher {
  useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  useActionState<S, Args extends unknown[]>(
    action: ActionStateAction<S, Args>,
    initialState: S,
  ): [S, ActionStateDispatch<Args>, boolean];
  useId(): string;
  useLaggedValue<T>(
    value: T,
    initialValue: T | undefined,
    hasInitialValue: boolean,
  ): T;
  useMemo<T>(calculate: () => T, deps: DependencyList): T;
  useTransition(): [boolean, StartTransition];
  useReactive(effect: EffectCallback, deps?: DependencyList): void;
  useBeforePaint(effect: EffectCallback, deps?: DependencyList): void;
  useBeforeLayout(effect: EffectCallback, deps?: DependencyList): void;
  useExternalStore<T>(
    subscribe: ExternalStoreSubscribe,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
  useReactiveEvent<Args extends unknown[], Result>(
    handler: (...args: Args) => Result,
  ): (...args: ReactiveEventArgs<Args>) => Result;
  readContext<T>(context: FigContext<T>): T;
  readPromise<T>(promise: PromiseLike<T>): T;
}

export type EffectCallback = (signal: AbortSignal) => undefined;
export type DependencyList = readonly unknown[];

// Fig appends the AbortSignal when invoking the handler; callers never pass
// it, so a declared trailing signal is stripped from the callable signature.
export type ReactiveEventArgs<Args extends unknown[]> = Args extends [
  ...infer Rest,
  AbortSignal,
]
  ? Rest
  : Args;

let currentDispatcher: RenderDispatcher | null = null;

export function useState<S>(
  initialState: S | (() => S),
): [S, Dispatch<SetStateAction<S>>] {
  return resolveDispatcher().useState(initialState);
}

/**
 * Tracks state returned by a client-side action. The action receives the
 * previous committed state first, followed by the dispatch arguments. Async
 * actions run in a transition priority scope and keep `isPending` true until
 * they settle.
 */
export function useActionState<S, Args extends unknown[]>(
  action: ActionStateAction<S, Args>,
  initialState: S,
): [S, ActionStateDispatch<Args>, boolean] {
  return resolveDispatcher().useActionState(action, initialState);
}

export function useId(): string {
  return resolveDispatcher().useId();
}

export function useLaggedValue<T>(value: T, initialValue?: T): T {
  return resolveDispatcher().useLaggedValue(
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

export function useExternalStore<T>(
  subscribe: ExternalStoreSubscribe,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  return resolveDispatcher().useExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
}

export function useReactiveEvent<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: ReactiveEventArgs<Args>) => Result {
  return resolveDispatcher().useReactiveEvent(handler);
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
