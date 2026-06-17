export type TransitionHandler = <T>(callback: () => T) => T;

let transitionHandler: TransitionHandler = (callback) => callback();

/**
 * Runs state updates scheduled by `callback` at transition priority. If
 * `callback` returns a thenable, updates after an `await` remain in the
 * transition priority scope until it settles.
 */
export function transition<T>(callback: () => T): T {
  return transitionHandler(callback);
}

export function setTransitionHandler(handler: TransitionHandler): void {
  transitionHandler = handler;
}
