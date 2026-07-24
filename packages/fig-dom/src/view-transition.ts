import type { Props } from "@bgub/fig";
import {
  VIEW_TRANSITION_PENDING_PROPERTY,
  VIEW_TRANSITION_TIMEOUT_MS,
} from "@bgub/fig/internal";
import type {
  ViewTransitionCommitResult,
  ViewTransitionHostConfig,
  ViewTransitionMutationResult,
  ViewTransitionSurfaceMeasurement,
} from "@bgub/fig-reconciler/view-transitions";
import type { Container } from "./events.ts";

interface RunningViewTransition {
  finished?: Promise<unknown>;
  ready?: Promise<unknown>;
}

interface CancellableAnimation {
  cancel(): void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: () => void,
  ) => RunningViewTransition | undefined;
  [VIEW_TRANSITION_PENDING_PROPERTY]?: RunningViewTransition | null;
};

function commitViewTransition(
  container: Container,
  prepareSnapshot: () => void,
  mutate: () => ViewTransitionMutationResult,
  cleanup: () => void,
): ViewTransitionCommitResult {
  const owner = ownerDocument(container);
  const start = owner.startViewTransition;
  if (typeof start !== "function") return false;

  let didMutate = false;
  let chained = false;
  let failedBeforeMutate = false;
  let restoreRootName: (() => void) | null = null;
  let mutationResult: ViewTransitionMutationResult | null = null;

  const run = (): void => {
    prepareSnapshot();
    try {
      const transition = start.call(owner, () => {
        didMutate = true;
        mutationResult = mutate();
        // Before the new capture: when measurement shows every change is
        // contained in a named boundary, drop the root's own snapshot so the
        // page-wide overlay does not swallow pointer events for the
        // animation's duration.
        if (mutationResult.cancelRootSnapshot) {
          restoreRootName = cancelRootViewTransitionName(owner);
        }
      });
      if (transition !== undefined) {
        registerPendingTransition(owner, transition);
        hideCanceledSnapshots(owner, transition, () => mutationResult);
      }
      // Root-name restore waits for the transition to fully settle: putting
      // `view-transition-name: root` back on the live <html> while the
      // transition still runs can re-associate the live root with its
      // (force-hidden) captured group, which paints the page blank for the
      // rest of the animation.
      const settleAfterTransition = transitionSettled(transition);
      const restore = (): void => restoreRootName?.();
      if (settleAfterTransition === undefined) {
        restore();
        cleanup();
      } else {
        (transition?.ready ?? settleAfterTransition).then(cleanup, cleanup);
        settleAfterTransition.then(restore, restore);
      }
    } catch (error) {
      restoreRootName?.();
      if (!didMutate) {
        // A chained run has no caller to report a fallback to and the
        // reconciler stays frozen until mutate runs: commit unanimated.
        // A synchronous run reports `false` so the caller falls back.
        if (chained) {
          didMutate = true;
          mutate();
        } else {
          failedBeforeMutate = true;
        }
        cleanup();
        return;
      }
      cleanup();
      if (!chained) throw error;
      // Chained commit errors were already routed by the reconciler's
      // deferred-commit handling; a residual throw here is a transition
      // failure that must not vanish into the pending promise.
      setTimeout(() => {
        throw error;
      });
    }
  };

  // Serialize per document: starting a transition while one is running makes
  // the browser abruptly skip the running animation, and the skipped
  // transition's restore could race this one's old-state capture. The
  // reconciler normally parks eligible commits upstream (render-during-wait
  // via the adapter's suspend hook), so for fig-dom this chain is a fallback
  // for renderers that wire commit without suspend — chaining freezes the root
  // until the previous animation settles or times out; parking keeps
  // rendering live.
  if (waitForActiveViewTransition(owner, run)) {
    chained = true;
    return "deferred";
  }

  run();
  if (failedBeforeMutate) return false;
  return didMutate ? "committed" : "deferred";
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
  transition: RunningViewTransition,
  getResult: () => ViewTransitionMutationResult | null,
): void {
  // The filled zero-duration animations outlive their pseudo tree: without
  // an explicit cancel once the transition settles they would apply to the
  // next transition's pseudo tree and hide its groups.
  const hideAnimations: CancellableAnimation[] = [];
  const cancelHideAnimations = (): void => {
    for (const animation of hideAnimations) {
      try {
        animation.cancel();
      } catch {
        // Cancelling a finished pseudo animation is best-effort.
      }
    }
    hideAnimations.length = 0;
  };

  const hide = (): void => {
    const result = getResult();
    if (result === null) return;
    if (result.canceledNames.length === 0 && !result.cancelRootSnapshot) {
      return;
    }

    const element = owner.documentElement as
      | (HTMLElement & {
          animate?: (
            keyframes: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => unknown;
        })
      | null;
    if (element === null || typeof element.animate !== "function") return;

    const track = (animation: unknown): void => {
      if (
        typeof (animation as CancellableAnimation | null)?.cancel === "function"
      ) {
        hideAnimations.push(animation as CancellableAnimation);
      }
    };

    const hideGroup = (name: string): void => {
      track(
        element.animate?.(
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
        track(
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
  };

  const ready = transition.ready ?? transition.finished;
  if (ready === undefined) hide();
  else ready.then(hide, () => undefined);

  const settled = transitionSettled(transition);
  if (settled === undefined) cancelHideAnimations();
  else settled.then(cancelHideAnimations, cancelHideAnimations);
}

function registerPendingTransition(
  owner: ViewTransitionDocument,
  transition: RunningViewTransition,
): void {
  owner[VIEW_TRANSITION_PENDING_PROPERTY] = transition;
  const release = (): void => {
    if (owner[VIEW_TRANSITION_PENDING_PROPERTY] === transition) {
      owner[VIEW_TRANSITION_PENDING_PROPERTY] = null;
    }
  };
  const settled = transitionSettled(transition);
  if (settled === undefined) release();
  else settled.then(release, release);
}

// React caps suspended commits at 60 seconds. Besides preventing a broken or
// infinite animation from parking work forever, releasing the document mutex
// lets the resumed commit start a new transition, which ends the stale one.
function waitForActiveViewTransition(
  owner: ViewTransitionDocument,
  onFinished: () => void,
): boolean {
  const pending = owner[VIEW_TRANSITION_PENDING_PROPERTY];
  if (pending == null) return false;
  const settled = transitionSettled(pending);
  if (settled === undefined) return false;

  let waiting = true;
  function finish(): void {
    if (!waiting) return;
    waiting = false;
    clearTimeout(timeout);
    if (owner[VIEW_TRANSITION_PENDING_PROPERTY] === pending) {
      owner[VIEW_TRANSITION_PENDING_PROPERTY] = null;
    }
    onFinished();
  }

  const timeout = setTimeout(finish, VIEW_TRANSITION_TIMEOUT_MS);
  settled.then(finish, finish);
  return true;
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

function escapeViewTransitionName(name: string): string {
  const escape = globalThis.CSS?.escape;
  return escape === undefined ? name : escape(name);
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
  // Park eligible commits behind the shared per-document mutex while
  // rendering continues, then re-schedule once the transition settles.
  suspend(container, onFinished) {
    return waitForActiveViewTransition(ownerDocument(container), onFinished);
  },
};
