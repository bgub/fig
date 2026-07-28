import type { TransitionOptions } from "@bgub/fig/internal";
import {
  includesSomeLane,
  laneToIndex,
  transitionOptionsHooks,
  type Lane,
  type Lanes,
} from "./lanes.ts";

interface ActiveTransitionOptions {
  interrupt: boolean;
  scopes: number;
  types: Set<string>;
}

interface RecordedTransitionOptions {
  interrupt: boolean;
  types: Set<string>;
}

export interface RootTransitionOptions {
  interrupt: boolean;
  types: string[];
}

const activeTransitions: Array<ActiveTransitionOptions | null> = [];
const rootTransitionOptions = new WeakMap<
  object,
  Map<Lane, RecordedTransitionOptions>
>();

export function getCurrentTransitionTypes(
  lane: Lane,
): ReadonlySet<string> | null {
  const transition = activeTransitions[laneToIndex(lane)];
  return transition === undefined ||
    transition === null ||
    transition.types.size === 0
    ? null
    : transition.types;
}

export function interruptsCurrentViewTransition(lane: Lane): boolean {
  return activeTransitions[laneToIndex(lane)]?.interrupt === true;
}

export function getRootTransitionOptions(
  root: object,
  renderLanes: Lanes,
): RootTransitionOptions {
  const result: RootTransitionOptions = {
    interrupt: false,
    types: [],
  };
  const optionsByLane = rootTransitionOptions.get(root);
  if (optionsByLane === undefined) return result;

  const types = new Set<string>();
  for (const [lane, options] of optionsByLane) {
    if (!includesSomeLane(renderLanes, lane)) continue;
    if (options.interrupt) result.interrupt = true;
    for (const type of options.types) types.add(type);
  }
  result.types = [...types];
  return result;
}

function retainTransitionOptions(
  lane: Lane,
  options: TransitionOptions | undefined,
): () => void {
  const index = laneToIndex(lane);
  let transition = activeTransitions[index];
  if (transition === undefined || transition === null) {
    transition = {
      interrupt: false,
      scopes: 0,
      types: new Set(),
    };
    activeTransitions[index] = transition;
  }
  transition.scopes += 1;

  if (options?.types !== undefined) {
    for (const type of options.types) transition.types.add(type);
  }
  if (options?.viewTransition === "interrupt") {
    transition.interrupt = true;
  }

  return () => {
    transition.scopes -= 1;
    if (transition.scopes === 0) activeTransitions[index] = null;
  };
}

function recordRootTransitionOptions(root: object, lane: Lane): void {
  const active = activeTransitions[laneToIndex(lane)];
  if (
    active === undefined ||
    active === null ||
    (active.types.size === 0 && !active.interrupt)
  ) {
    return;
  }

  let optionsByLane = rootTransitionOptions.get(root);
  if (optionsByLane === undefined) {
    optionsByLane = new Map();
    rootTransitionOptions.set(root, optionsByLane);
  }
  let pending = optionsByLane.get(lane);
  if (pending === undefined) {
    pending = { interrupt: false, types: new Set() };
    optionsByLane.set(lane, pending);
  }
  if (active.interrupt) pending.interrupt = true;
  for (const type of active.types) pending.types.add(type);
}

function completeRootTransitionOptions(
  root: object,
  remainingLanes: Lanes,
): void {
  const optionsByLane = rootTransitionOptions.get(root);
  if (optionsByLane === undefined) return;

  for (const lane of optionsByLane.keys()) {
    if (!includesSomeLane(remainingLanes, lane)) optionsByLane.delete(lane);
  }
  if (optionsByLane.size === 0) rootTransitionOptions.delete(root);
}

transitionOptionsHooks.retain = retainTransitionOptions;
transitionOptionsHooks.record = recordRootTransitionOptions;
transitionOptionsHooks.complete = completeRootTransitionOptions;
