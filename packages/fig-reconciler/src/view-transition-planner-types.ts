import type { Props } from "@bgub/fig";
import type { Tag } from "./fiber-tags.ts";
import type { Flag } from "./fiber-work.ts";
import type { Lanes } from "./lanes.ts";

// Private structural views shared by the reconciler and its optional planner.
// Fiber and FiberRoot extend these interfaces, so the planner's same-package
// identity casts cannot silently drift from the real reconciler shapes.
export interface ViewTransitionPlannerFiber {
  tag: Tag;
  props: Props;
  memoizedProps: Props | null;
  committedProps: Props | null;
  stateNode: unknown;
  return: ViewTransitionPlannerFiber | null;
  child: ViewTransitionPlannerFiber | null;
  sibling: ViewTransitionPlannerFiber | null;
  alternate: ViewTransitionPlannerFiber | null;
  flags: Flag;
  subtreeFlags: Flag;
  deletions: ViewTransitionPlannerFiber[] | null;
}

export interface ViewTransitionPlannerRoot<Container> {
  container: Container;
  renderLanes: Lanes;
  clearContainerBeforeCommit: boolean;
  needsCommitDeletions: boolean;
  commitIndex: ViewTransitionPlannerFiber[];
}

export interface ViewTransitionPlannerState {
  autoName: string | null;
}
