import { createViewTransitionCommitCoordinator } from "@bgub/fig-reconciler/view-transitions";
import { domRenderer } from "./renderer.ts";
import { viewTransitionHostConfig } from "./view-transition.ts";

const viewTransitionCommitCoordinator = createViewTransitionCommitCoordinator(
  viewTransitionHostConfig,
);

export function enableViewTransitions(): void {
  domRenderer.installCommitCoordinator(viewTransitionCommitCoordinator);
}
