export type TransitionHandler = <T>(callback: () => T) => T;

let transitionHandler: TransitionHandler = (callback) => callback();

export function transition<T>(callback: () => T): T {
  return transitionHandler(callback);
}

export function setTransitionHandler(handler: TransitionHandler): void {
  transitionHandler = handler;
}
