/**
 * Opt-in DOM View Transition integration for Fig.
 *
 * @module
 */
import { createViewTransitionCommitCoordinator } from "@bgub/fig-reconciler/view-transitions";
import { domRenderer } from "./renderer.ts";
import { viewTransitionHostConfig } from "./view-transition.ts";

export {
  getViewTransitionPseudoElements,
  type ViewTransitionPseudoElement,
  type ViewTransitionPseudoElements,
} from "./view-transition-pseudos.ts";

const coordinator = createViewTransitionCommitCoordinator(
  viewTransitionHostConfig,
);

/** Enables view transitions. */
export function enableViewTransitions(): void {
  domRenderer.installCommitCoordinator(coordinator);
}
