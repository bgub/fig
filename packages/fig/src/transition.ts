import { getCurrentDataStore, setCurrentDataStore } from "./data.ts";
import { isThenable } from "./thenables.ts";

/** Describes transition options. */
export interface TransitionOptions {
  types?: readonly string[];
  /**
   * Interrupts an active native View Transition before committing this
   * transition. The new commit still waits for the interrupted transition to
   * settle so host restoration cannot race its old-state snapshot.
   */
  viewTransition?: "interrupt";
}

/** Runs synchronous work owned by a live transition. Calls after retirement are inert. */
export type TransitionUpdate = (callback: () => void) => void;

/** The signal and explicit update scope belong to this callback invocation. */
export type TransitionCallback<T = void | PromiseLike<void>> = (
  signal: AbortSignal,
  update: TransitionUpdate,
) => T;

/** Describes transition handler. */
export type TransitionHandler = <T>(
  callback: TransitionCallback<T>,
  options?: TransitionOptions,
) => T;

let transitionHandler: TransitionHandler = (callback) =>
  runTransitionScope(callback, (run) => run());

/**
 * Synchronous updates inherit transition priority. After awaiting, use the
 * callback's update function to schedule work in this same transition.
 */
export function transition<T>(
  callback: TransitionCallback<T>,
  options?: TransitionOptions,
): T {
  return transitionHandler(callback, options);
}

/** Internal lifetime protocol shared by renderer and renderer-free scopes. */
export function runTransitionScope<T>(
  callback: TransitionCallback<T>,
  enter: <Result>(run: () => Result) => Result,
  controller = new AbortController(),
): T {
  const signal = controller.signal;
  const store = getCurrentDataStore();
  const runInScope = <Result>(run: () => Result): Result => {
    const previousStore = setCurrentDataStore(store);
    try {
      return enter(run);
    } finally {
      setCurrentDataStore(previousStore);
    }
  };
  const update: TransitionUpdate = (run) => {
    if (signal.aborted) return;
    const result: unknown = runInScope(run);
    if (isThenable(result)) {
      // Consume rejection from an invalid async callback before reporting the
      // contract violation. The asynchronous continuation is outside the scope.
      result.then(
        () => undefined,
        () => undefined,
      );
      throw new Error("Transition update callbacks must be synchronous.");
    }
  };
  const finish = () => controller.abort();
  try {
    const result = runInScope(() => callback(signal, update));
    if (isThenable(result)) result.then(finish, finish);
    else finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

/** Sets transition handler. */
export function setTransitionHandler(
  handler: TransitionHandler,
): TransitionHandler {
  const previous = transitionHandler;
  transitionHandler = handler;
  return previous;
}
