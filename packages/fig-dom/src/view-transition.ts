import type { Props } from "@bgub/fig";
import {
  VIEW_TRANSITION_PENDING_PROPERTY,
  VIEW_TRANSITION_TIMEOUT_MS,
} from "@bgub/fig/internal";
import type {
  ViewTransitionCommitOptions,
  ViewTransitionCommitResult,
  ViewTransitionHostConfig,
  ViewTransitionMutationResult,
  ViewTransitionSurfaceMeasurement,
} from "@bgub/fig-reconciler/view-transitions";
import type { Container } from "./events.ts";
import {
  createDOMViewTransitionSurface,
  escapeViewTransitionName,
} from "./view-transition-pseudos.ts";

interface RunningViewTransition {
  finished?: Promise<unknown>;
  ready?: Promise<unknown>;
  skipTransition?(): void;
}

type ViewTransitionDocument = Document & {
  [VIEW_TRANSITION_PENDING_PROPERTY]?: RunningViewTransition | null;
};

const interruptedTransitions = new WeakSet<object>();

function commitViewTransition(
  container: Container,
  options: ViewTransitionCommitOptions,
  prepareSnapshot: () => void,
  mutate: () => ViewTransitionMutationResult,
  onReady: (active: boolean) => void,
  onFinished: () => void,
): ViewTransitionCommitResult {
  const owner = ownerDocument(container);
  const start = owner.startViewTransition?.bind(owner);
  if (start === undefined) return false;

  let didMutate = false;
  let interrupted = false;
  let captureReleased = false;
  let transition: RunningViewTransition | undefined;
  let releaseTransition: (() => void) | null = null;
  let chained = false;
  let failedBeforeMutate = false;
  let restoreRootName: (() => void) | null = null;
  let cancelSnapshots: (() => void) | null = null;
  let mutationResult: ViewTransitionMutationResult | null = null;
  const completeCapture = (active: boolean): void => {
    if (captureReleased) return;
    captureReleased = true;
    onReady(active);
  };
  // Finish lifecycle callbacks before releasing document ownership, even when
  // one throws or reenters completion. Native callbacks may still arrive later.
  const completeTransition = once(() => {
    try {
      cancelSnapshots?.();
      restoreRootName?.();
      completeCapture(false);
    } finally {
      try {
        onFinished();
      } finally {
        releaseTransition?.();
      }
    }
  });

  const interrupt = (): void => {
    if (interrupted || captureReleased) return;
    interrupted = true;
    try {
      transition?.skipTransition?.();
    } catch {
      // Browser cancellation is best-effort; synchronous work must still run.
    }
    try {
      if (!didMutate) {
        didMutate = true;
        mutate();
      }
    } finally {
      completeTransition();
    }
  };

  const run = (): void => {
    if (interrupted) return;
    prepareSnapshot();
    try {
      const update = () => {
        if (interrupted || didMutate) return;
        didMutate = true;
        mutationResult = mutate();
        if (mutationResult.cancelTransition) {
          // A synchronous native callback runs before start returns its handle.
          // In that case, cancel below as soon as the handle is available.
          if (transition !== undefined) interrupt();
          return;
        }
        // Before the new capture: when measurement shows every change is
        // contained in a named boundary, drop the root's own snapshot so the
        // page-wide overlay does not swallow pointer events for the
        // animation's duration.
        if (mutationResult.cancelRootSnapshot) {
          restoreRootName = cancelRootViewTransitionName(owner);
        }
      };
      transition = start(
        options.types.length === 0
          ? update
          : { types: [...options.types], update },
      );
      if (transition !== undefined) {
        releaseTransition = acquireTransitionLock(owner, transition);
      }
      // Root-name restore waits for the transition to fully settle: putting
      // `view-transition-name: root` back on the live <html> while the
      // transition still runs can re-associate the live root with its
      // (force-hidden) captured group, which paints the page blank for the
      // rest of the animation.
      const settleAfterTransition = transitionSettled(transition);
      const ready = (): void => {
        if (captureReleased || interrupted) return;
        if (!didMutate) {
          interrupt();
          return;
        }
        if (transition !== undefined && mutationResult !== null) {
          cancelSnapshots = hideCanceledSnapshots(owner, mutationResult);
        }
        completeCapture(transition?.ready !== undefined);
      };
      if (settleAfterTransition === undefined) {
        ready();
        completeTransition();
      } else {
        (transition?.ready ?? settleAfterTransition).then(ready, () => {
          if (transition?.ready !== undefined || !didMutate) interrupt();
          else completeCapture(false);
        });
        onSettled(settleAfterTransition, () => {
          if (!captureReleased) interrupt();
          else completeTransition();
        });
      }
      // Install native rejection handlers before cancellation can reject ready,
      // including when start invokes the mutation synchronously.
      if (mutationResult?.cancelTransition) interrupt();
    } catch (error) {
      if (!didMutate) {
        // A chained run has no caller to report a fallback to and the
        // reconciler stays frozen until mutate runs: commit unanimated.
        // A synchronous run reports `false` so the caller falls back.
        if (chained) {
          didMutate = true;
          try {
            mutate();
          } finally {
            completeTransition();
          }
        } else {
          failedBeforeMutate = true;
          completeTransition();
        }
        return;
      }
      completeTransition();
      if (!chained) throw error;
      // Chained commit errors were already routed by the reconciler's
      // deferred-commit handling; a residual throw here is a transition
      // failure that must not vanish into the pending promise.
      setTimeout(() => {
        throw error;
      });
    }
  };

  // Coordinate per document: the default serializes animations, while an
  // explicit interruption skips the active one but still waits for its
  // restoration before capturing the next old state. The reconciler normally
  // parks eligible commits upstream (render-during-wait via the adapter's
  // suspend hook), so for fig-dom this chain is a fallback for renderers that
  // wire commit without suspend — chaining freezes the root until the previous
  // animation settles or times out; parking keeps rendering live.
  if (coordinateActiveViewTransition(owner, options.interrupt, run)) {
    chained = true;
    return { interrupt };
  }

  run();
  if (failedBeforeMutate) return false;
  return captureReleased ? "committed" : { interrupt };
}

// Remove the root element from the new capture, remembering how to restore
// the author's inline style afterwards.
function cancelRootViewTransitionName(
  owner: ViewTransitionDocument,
): () => void {
  const element = owner.documentElement;
  const style = element.style;
  const previous = style.viewTransitionName ?? "";
  style.viewTransitionName = "none";

  return () => {
    style.viewTransitionName = previous;
    if (element.getAttribute("style") === "") element.removeAttribute("style");
  };
}

// Old snapshots were captured before the update callback ran and cannot be
// un-captured; once the pseudo tree exists (ready), hide the groups of
// measurement-canceled boundaries — and the root group plus the
// ::view-transition overlay when the whole-page snapshot was dropped — with
// filling zero-duration animations so untouched regions stay interactive
// while the remaining groups animate. Mirrors React's
// cancelViewTransitionName / cancelRootViewTransitionName.
function hideCanceledSnapshots(
  owner: ViewTransitionDocument,
  result: ViewTransitionMutationResult,
): (() => void) | null {
  const element = owner.documentElement;
  if (
    (result.canceledNames.length === 0 && !result.cancelRootSnapshot) ||
    typeof element.animate !== "function"
  )
    return null;

  // Filled animations must be canceled before the next transition can reuse
  // their pseudo-element names. The commit lifecycle owns that cleanup.
  const hideAnimations: Animation[] = [];

  const hideGroup = (name: string): void => {
    hideAnimations.push(
      element.animate(
        { opacity: [0, 0], pointerEvents: ["none", "none"] },
        {
          duration: 0,
          fill: "forwards",
          pseudoElement: `::view-transition-group(${name})`,
        },
      ),
    );
  };

  try {
    for (const name of result.canceledNames) {
      hideGroup(escapeViewTransitionName(name));
    }
    if (result.cancelRootSnapshot) {
      hideGroup("root");
      hideAnimations.push(
        element.animate(
          { height: [0, 0], width: [0, 0] },
          {
            duration: 0,
            fill: "forwards",
            pseudoElement: "::view-transition",
          },
        ),
      );
    }
  } catch {
    // Pseudo-element animation is best-effort: without it the canceled
    // snapshots fall back to the browser's default cross-fade.
  }

  return () => {
    for (const animation of hideAnimations) {
      try {
        animation.cancel();
      } catch {
        // Cancelling a finished pseudo animation is best-effort.
      }
    }
    hideAnimations.length = 0;
  };
}

// The shared document lock exposes logical completion to both client commits
// and streamed reveals. Cancellation releases all existing waiters even if the
// browser's finished promise never settles; native callbacks keep their handle.
function acquireTransitionLock(
  owner: ViewTransitionDocument,
  transition: RunningViewTransition,
): () => void {
  let resolveFinished!: () => void;
  const pending: RunningViewTransition = {
    finished: new Promise<void>((resolve) => {
      resolveFinished = resolve;
    }),
    skipTransition: transition.skipTransition?.bind(transition),
  };
  owner[VIEW_TRANSITION_PENDING_PROPERTY] = pending;
  const release = (): void => {
    if (owner[VIEW_TRANSITION_PENDING_PROPERTY] === pending) {
      owner[VIEW_TRANSITION_PENDING_PROPERTY] = null;
    }
    resolveFinished();
  };
  return release;
}

// React caps suspended commits at 60 seconds. Besides preventing a broken or
// infinite animation from parking work forever, releasing the document mutex
// lets the resumed commit start a new transition, which ends the stale one.
function coordinateActiveViewTransition(
  owner: ViewTransitionDocument,
  interrupt: boolean,
  onFinished: () => void,
): boolean {
  const pending = owner[VIEW_TRANSITION_PENDING_PROPERTY];
  if (pending == null) return false;
  const settled = transitionSettled(pending);
  if (settled === undefined) return false;

  const finish = once(() => {
    clearTimeout(timeout);
    if (owner[VIEW_TRANSITION_PENDING_PROPERTY] === pending) {
      owner[VIEW_TRANSITION_PENDING_PROPERTY] = null;
    }
    onFinished();
  });

  const timeout = setTimeout(finish, VIEW_TRANSITION_TIMEOUT_MS);
  onSettled(settled, finish);
  if (
    interrupt &&
    pending.skipTransition !== undefined &&
    !interruptedTransitions.has(pending)
  ) {
    interruptedTransitions.add(pending);
    try {
      pending.skipTransition();
    } catch {
      interruptedTransitions.delete(pending);
      // A failed interruption falls back to waiting for normal settlement.
    }
  }
  return true;
}

function onSettled(promise: Promise<unknown>, callback: () => void): void {
  promise.then(callback, callback);
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}

function transitionSettled(
  transition: RunningViewTransition | undefined,
): Promise<unknown> | undefined {
  return transition?.finished ?? transition?.ready;
}

function measureViewTransitionSurface(
  element: Element,
): ViewTransitionSurfaceMeasurement | null {
  if (typeof element.getBoundingClientRect !== "function") return null;

  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument?.defaultView ?? null;
  const inViewport =
    view === null
      ? true
      : rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= view.innerHeight &&
        rect.left <= view.innerWidth;
  let absolutelyPositioned = false;
  try {
    absolutelyPositioned =
      view?.getComputedStyle(element).position === "absolute";
  } catch {
    // Detached elements or minimal test environments: assume static
    // positioning, the conservative choice (resizes keep the root snapshot).
  }

  return {
    absolutelyPositioned,
    height: rect.height,
    inViewport,
    width: rect.width,
    x: rect.left,
    y: rect.top,
  };
}

function applyViewTransitionName(
  element: Element,
  name: string,
  className: string | null,
): void {
  const style = (element as HTMLElement).style;

  style.viewTransitionName = escapeViewTransitionName(name);
  if (className !== null) style.viewTransitionClass = className;
}

function restoreViewTransitionName(element: Element, props: Props): void {
  const style = (element as HTMLElement).style;
  const styleProp = props.style;
  const name =
    styleProp?.viewTransitionName ?? styleProp?.["view-transition-name"];
  const className =
    styleProp?.viewTransitionClass ?? styleProp?.["view-transition-class"];

  style.viewTransitionName = styleValue(name);
  style.viewTransitionClass = styleValue(className);
}

function ownerDocument(container: Container): ViewTransitionDocument {
  return (container.ownerDocument ?? document) as ViewTransitionDocument;
}

function styleValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  return "";
}

export const viewTransitionHostConfig: ViewTransitionHostConfig<
  Container,
  Element
> = {
  commit: commitViewTransition,
  apply: applyViewTransitionName,
  restore: restoreViewTransitionName,
  measure: measureViewTransitionSurface,
  createSurface: createDOMViewTransitionSurface,
  // Park eligible commits behind the shared per-document mutex while
  // rendering continues, then re-schedule once the transition settles.
  suspend(container, options, onFinished) {
    return coordinateActiveViewTransition(
      ownerDocument(container),
      options.interrupt,
      onFinished,
    );
  },
};
