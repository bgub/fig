// Effect hooks reuse their phase as their hook kind. Keeping the shared
// numeric vocabulary here lets rendering and DevTools interpret hooks without
// making either module depend on the other's implementation.
export const ReactiveEffect = 0;
export const BeforePaintEffect = 1;
export const BeforeLayoutEffect = 2;

export type EffectPhase =
  | typeof ReactiveEffect
  | typeof BeforePaintEffect
  | typeof BeforeLayoutEffect;

export const StateHook = 3;
export const ActionStateHook = 4;
export const IdHook = 5;
export const DeferredValueHook = 6;
export const ExternalStoreHook = 7;
export const MemoHook = 8;
export const TransitionHook = 9;
export const StableEventHook = 10;

export type HookKind = number;

export const hookKindNames = [
  "reactive",
  "before-paint",
  "before-layout",
  "state",
  "action-state",
  "id",
  "deferred-value",
  "external-store",
  "memo",
  "transition",
  "stable-event",
] as const;

export function isEffectHook(kind: HookKind): boolean {
  return kind <= BeforeLayoutEffect;
}
