export type SetStateAction<S> = S | ((previousState: S) => S);
export type Dispatch<A> = (action: A) => void;

export interface HookDispatcher {
  useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  useReactive(effect: EffectCallback, deps?: DependencyList): void;
  useBeforePaint(effect: EffectCallback, deps?: DependencyList): void;
  useBeforeLayout(effect: EffectCallback, deps?: DependencyList): void;
  useOnMount(effect: EffectCallback): void;
}

export type EffectCallback = (signal: AbortSignal) => undefined;
export type DependencyList = readonly unknown[];

let currentDispatcher: HookDispatcher | null = null;

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

export function setCurrentDispatcher(
  dispatcher: HookDispatcher | null,
): HookDispatcher | null {
  const previousDispatcher = currentDispatcher;
  currentDispatcher = dispatcher;
  return previousDispatcher;
}

function resolveDispatcher(): HookDispatcher {
  if (currentDispatcher === null) {
    throw new Error("Hooks can only be called while rendering a component.");
  }

  return currentDispatcher;
}
