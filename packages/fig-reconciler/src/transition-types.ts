import {
  includesSomeLane,
  laneToIndex,
  transitionTypeHooks,
  type Lane,
  type Lanes,
} from "./lanes.ts";

interface ActiveTransition {
  scopes: number;
  types: Set<string>;
}

const activeTransitions: Array<ActiveTransition | null> = [];
const rootTransitionTypes = new WeakMap<object, Map<Lane, Set<string>>>();

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

export function getRootTransitionTypes(
  root: object,
  renderLanes: Lanes,
): string[] {
  const types = new Set<string>();
  const typesByLane = rootTransitionTypes.get(root);
  if (typesByLane === undefined) return [];

  for (const [lane, laneTypes] of typesByLane) {
    if (!includesSomeLane(renderLanes, lane)) continue;
    for (const type of laneTypes) types.add(type);
  }
  return [...types];
}

function retainTransitionTypes(
  lane: Lane,
  types: readonly string[] | undefined,
): () => void {
  const index = laneToIndex(lane);
  let transition = activeTransitions[index];
  if (transition === undefined || transition === null) {
    transition = { scopes: 0, types: new Set() };
    activeTransitions[index] = transition;
  }
  transition.scopes += 1;

  if (types !== undefined) {
    for (const type of types) transition.types.add(type);
  }

  return () => {
    transition.scopes -= 1;
    if (transition.scopes === 0) activeTransitions[index] = null;
  };
}

function recordRootTransitionTypes(root: object, lane: Lane): void {
  const types = getCurrentTransitionTypes(lane);
  if (types === null) return;

  let typesByLane = rootTransitionTypes.get(root);
  if (typesByLane === undefined) {
    typesByLane = new Map();
    rootTransitionTypes.set(root, typesByLane);
  }
  let pendingTypes = typesByLane.get(lane);
  if (pendingTypes === undefined) {
    pendingTypes = new Set();
    typesByLane.set(lane, pendingTypes);
  }
  for (const type of types) pendingTypes.add(type);
}

function completeRootTransitionTypes(
  root: object,
  remainingLanes: Lanes,
): void {
  const typesByLane = rootTransitionTypes.get(root);
  if (typesByLane === undefined) return;

  for (const lane of typesByLane.keys()) {
    if (!includesSomeLane(remainingLanes, lane)) typesByLane.delete(lane);
  }
  if (typesByLane.size === 0) rootTransitionTypes.delete(root);
}

transitionTypeHooks.retain = retainTransitionTypes;
transitionTypeHooks.record = recordRootTransitionTypes;
transitionTypeHooks.complete = completeRootTransitionTypes;
