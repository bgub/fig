export interface TransitionOptions {
  types?: readonly string[];
}

export type TransitionHandler = <T>(
  callback: () => T,
  options?: TransitionOptions,
) => T;

let transitionHandler: TransitionHandler = (callback) => callback();

/**
 * Runs state updates scheduled by `callback` at transition priority. If
 * `callback` returns a thenable, updates after an `await` remain in the
 * transition priority scope until it settles.
 */
export function transition<T>(
  callback: () => T,
  options?: TransitionOptions,
): T {
  return transitionHandler(callback, options);
}

export function setTransitionHandler(
  handler: TransitionHandler,
): TransitionHandler {
  const previous = transitionHandler;
  transitionHandler = handler;
  return previous;
}
