import type { FigContext } from "./context.ts";

export type SetStateAction<S> = S | ((previousState: S) => S);
export type Dispatch<A> = (action: A) => void;
export type ExternalStoreSubscribe = (callback: () => void) => () => void;
export type StartTransition = (callback: () => void) => void;
type Callback = (...args: never[]) => unknown;

export interface RenderDispatcher {
  useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
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
  useOnMount(effect: EffectCallback): void;
  useExternalStore<T>(
    subscribe: ExternalStoreSubscribe,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
  readContext<T>(context: FigContext<T>): T;
  readPromise<T>(promise: PromiseLike<T>): T;
}

export type EffectCallback = (signal: AbortSignal) => undefined;
export type DependencyList = readonly unknown[];

let currentDispatcher: RenderDispatcher | null = null;

export function useState<S>(
  initialState: S | (() => S),
): [S, Dispatch<SetStateAction<S>>] {
  return resolveDispatcher().useState(initialState);
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

export function useOnMount(effect: EffectCallback): void {
  resolveDispatcher().useOnMount(effect);
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
