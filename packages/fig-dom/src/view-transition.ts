import type { Props } from "@bgub/fig";
import { VIEW_TRANSITION_PENDING_PROPERTY } from "@bgub/fig/internal";
import type { ViewTransitionCommitResult } from "@bgub/fig-reconciler";
import type { Container } from "./events.ts";

interface RunningViewTransition {
  finished?: Promise<unknown>;
  ready?: Promise<unknown>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: () => void,
  ) => RunningViewTransition | undefined;
  [VIEW_TRANSITION_PENDING_PROPERTY]?: RunningViewTransition | null;
};

interface CssGlobal {
  CSS?: {
    escape?: (value: string) => string;
  };
}

export function commitViewTransition(
  container: Container,
  prepareSnapshot: () => void,
  mutate: () => void,
  cleanup: () => void,
  cancelRootSnapshot = false,
): ViewTransitionCommitResult {
  const owner = ownerDocument(container) as ViewTransitionDocument;
  const start = owner.startViewTransition;
  if (typeof start !== "function") return false;

  let didMutate = false;
  let chained = false;
  let failedBeforeMutate = false;
  let restoreRootName: (() => void) | null = null;

  const run = (): void => {
    prepareSnapshot();
    try {
      const transition = start.call(owner, () => {
        didMutate = true;
        mutate();
        // Before the new capture: when every change is contained in a named
        // boundary, drop the root's own snapshot so the page-wide overlay
        // does not swallow pointer events for the animation's duration.
        if (cancelRootSnapshot) {
          restoreRootName = cancelRootViewTransitionName(owner);
        }
      });
      if (transition !== undefined) {
        registerPendingTransition(owner, transition);
        if (cancelRootSnapshot) hideCapturedRootSnapshot(owner, transition);
      }
      const cleanupAfterSnapshot = transition?.ready ?? transition?.finished;
      const finalize = (): void => {
        restoreRootName?.();
        cleanup();
      };
      if (cleanupAfterSnapshot === undefined) finalize();
      else cleanupAfterSnapshot.then(finalize, finalize);
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
  // transition's restore could race this one's old-state capture. Matches
  // React's suspend-on-active-transition behavior; the mutex is shared with
  // the inline streaming runtime.
  const pending = owner[VIEW_TRANSITION_PENDING_PROPERTY];
  const pendingSettled = pending?.finished ?? pending?.ready;
  if (pending != null && pendingSettled !== undefined) {
    chained = true;
    pendingSettled.then(run, run);
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
  const element = owner.documentElement as HTMLElement | null;
  if (element === null) return () => undefined;

  const style = element.style as CSSStyleDeclaration & {
    viewTransitionName?: string;
  };
  const previous = style.viewTransitionName ?? "";
  style.viewTransitionName = "none";

  return () => {
    style.viewTransitionName = previous;
    if (element.getAttribute("style") === "") element.removeAttribute("style");
  };
}

// The old root snapshot was captured before the update callback ran and
// cannot be un-captured; once the pseudo tree exists (ready), hide its group
// with a filling zero-duration animation and zero-size the ::view-transition
// overlay so untouched regions stay interactive while named groups animate.
// Mirrors React's cancelRootViewTransitionName.
function hideCapturedRootSnapshot(
  owner: ViewTransitionDocument,
  transition: RunningViewTransition,
): void {
  const hide = (): void => {
    const element = owner.documentElement as
      | (HTMLElement & {
          animate?: (
            keyframes: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => unknown;
        })
      | null;
    if (element === null || typeof element.animate !== "function") return;

    try {
      element.animate(
        { opacity: [0, 0], pointerEvents: ["none", "none"] },
        {
          duration: 0,
          fill: "forwards",
          pseudoElement: "::view-transition-group(root)",
        },
      );
      element.animate(
        { height: [0, 0], width: [0, 0] },
        { duration: 0, fill: "forwards", pseudoElement: "::view-transition" },
      );
    } catch {
      // Pseudo-element animation is best-effort: without it the canceled
      // root snapshot falls back to the browser's default cross-fade.
    }
  };

  const ready = transition.ready ?? transition.finished;
  if (ready === undefined) hide();
  else ready.then(hide, () => undefined);
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
  const settled = transition.finished ?? transition.ready;
  if (settled === undefined) release();
  else settled.then(release, release);
}

export function applyViewTransitionName(
  element: Element,
  name: string,
  className: string | null,
): void {
  const style = (element as HTMLElement).style as CSSStyleDeclaration & {
    viewTransitionClass?: string;
    viewTransitionName?: string;
  };

  style.viewTransitionName = escapeViewTransitionName(name);
  if (className !== null) style.viewTransitionClass = className;
}

export function restoreViewTransitionName(
  element: Element,
  props: Props,
): void {
  const style = (element as HTMLElement).style as CSSStyleDeclaration & {
    viewTransitionClass?: string;
    viewTransitionName?: string;
  };
  const styleProp = props.style as Record<string, unknown> | undefined;
  const name =
    styleProp?.viewTransitionName ?? styleProp?.["view-transition-name"];
  const className =
    styleProp?.viewTransitionClass ?? styleProp?.["view-transition-class"];

  style.viewTransitionName = styleValue(name);
  style.viewTransitionClass = styleValue(className);
}

function ownerDocument(container: Container): Document {
  return "ownerDocument" in container && container.ownerDocument !== null
    ? container.ownerDocument
    : document;
}

function escapeViewTransitionName(name: string): string {
  const escape = (globalThis as CssGlobal).CSS?.escape;
  return escape === undefined ? name : escape(name);
}

function styleValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  return "";
}
