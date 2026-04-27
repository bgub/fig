import type { FigContext } from "./context.ts";

export type SetStateAction<S> = S | ((previousState: S) => S);
export type Dispatch<A> = (action: A) => void;

export interface RenderDispatcher {
  useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  useReactive(effect: EffectCallback, deps?: DependencyList): void;
  useBeforePaint(effect: EffectCallback, deps?: DependencyList): void;
  useBeforeLayout(effect: EffectCallback, deps?: DependencyList): void;
  useOnMount(effect: EffectCallback): void;
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
