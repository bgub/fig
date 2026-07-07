import { isThenable } from "@bgub/fig/internal";
import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  type PriorityLevel,
  UserBlockingPriority,
} from "./scheduler.ts";

export type Lane = number;
export type Lanes = number;
export type LaneMap<T extends number> = T[];

export const TotalLanes = 31;
export const NoTimestamp = -1;
export const NoLane = 0;
export const NoLanes = 0;

export const SyncHydrationLane = 1 << 0;
export const SyncLane = 1 << 1;
export const InputContinuousHydrationLane = 1 << 2;
export const InputContinuousLane = 1 << 3;
export const DefaultHydrationLane = 1 << 4;
export const DefaultLane = 1 << 5;
export const GestureLane = 1 << 6;
export const TransitionHydrationLane = 1 << 7;
export const TransitionLane1 = 1 << 8;
export const TransitionLane2 = 1 << 9;
export const TransitionLane3 = 1 << 10;
export const TransitionLane4 = 1 << 11;
export const TransitionLane5 = 1 << 12;
export const TransitionLane6 = 1 << 13;
export const TransitionLane7 = 1 << 14;
export const TransitionLane8 = 1 << 15;
export const TransitionLane9 = 1 << 16;
export const TransitionLane10 = 1 << 17;
export const TransitionLane11 = 1 << 18;
export const TransitionLane12 = 1 << 19;
export const TransitionLane13 = 1 << 20;
export const TransitionLane14 = 1 << 21;
export const RetryLane1 = 1 << 22;
export const RetryLane2 = 1 << 23;
export const RetryLane3 = 1 << 24;
export const RetryLane4 = 1 << 25;
export const SelectiveHydrationLane = 1 << 26;
export const IdleHydrationLane = 1 << 27;
export const IdleLane = 1 << 28;
export const OffscreenLane = 1 << 29;
export const DeferredLane = 1 << 30;

export const TransitionLane = TransitionLane1;

export const TransitionLanes =
  TransitionLane1 |
  TransitionLane2 |
  TransitionLane3 |
  TransitionLane4 |
  TransitionLane5 |
  TransitionLane6 |
  TransitionLane7 |
  TransitionLane8 |
  TransitionLane9 |
  TransitionLane10;
export const TransitionDeferredLanes =
  TransitionLane11 | TransitionLane12 | TransitionLane13 | TransitionLane14;
export const AllTransitionLanes = TransitionLanes | TransitionDeferredLanes;
export const RetryLanes = RetryLane1 | RetryLane2 | RetryLane3 | RetryLane4;
export const IdleLanes = IdleHydrationLane | IdleLane | OffscreenLane;
export const NonIdleLanes = (1 << 27) - 1;
export const HydrationLanes =
  SyncHydrationLane |
  InputContinuousHydrationLane |
  DefaultHydrationLane |
  TransitionHydrationLane |
  SelectiveHydrationLane |
  IdleHydrationLane;

export type LanePriority =
  | "sync"
  | "input"
  | "default"
  | "gesture"
  | "transition"
  | "retry"
  | "idle"
  | "offscreen"
  | "deferred";

export interface LaneRoot {
  pendingLanes: Lanes;
  suspendedLanes: Lanes;
  pingedLanes: Lanes;
  expiredLanes: Lanes;
  entangledLanes: Lanes;
  entanglements: LaneMap<Lanes>;
  expirationTimes: LaneMap<number>;
}

const syncLaneExpirationMs = 250;
const transitionLaneExpirationMs = 5_000;

let currentUpdateLane: Lane = DefaultLane;
let nextTransitionLane: Lane = TransitionLane1;
let nextRetryLane: Lane = RetryLane1;
// JavaScript does not expose per-continuation async context in browsers yet, so
// async transitions keep their lane ambient while the returned thenable is
// pending. Explicit event/sync priorities still override this fallback.
let asyncTransitionLanes: Lanes = NoLanes;
const asyncTransitionLaneCounts = createLaneMap<number>(0);

export function createLaneMap<T extends number>(initial: T): LaneMap<T> {
  return Array.from({ length: TotalLanes }, () => initial);
}

export function mergeLanes(a: Lanes, b: Lanes): Lanes {
  return a | b;
}

export function includesSomeLane(set: Lanes, subset: Lanes): boolean {
  return (set & subset) !== NoLanes;
}

export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

export function getHighestPriorityLanes(lanes: Lanes): Lanes {
  const lane = getHighestPriorityLane(lanes);

  if (includesSomeLane(AllTransitionLanes, lane)) {
    return lanes & AllTransitionLanes;
  }

  if (includesSomeLane(RetryLanes, lane)) {
    return lanes & RetryLanes;
  }

  return lane;
}

export function getNextLanes(root: LaneRoot, wipLanes: Lanes = NoLanes): Lanes {
  const pending = root.pendingLanes;
  if (pending === NoLanes) return NoLanes;

  const unblocked = pending & ~root.suspendedLanes;
  const pinged = pending & root.pingedLanes;
  let next = root.expiredLanes & unblocked;
  if (next === NoLanes) {
    next = getHighestPriorityLanes(unblocked);

    if (next === NoLanes) {
      // Expired pinged work wins over fresh pinged work; NoLanes is 0, so the
      // fallback only runs when no expired pinged lane exists.
      const expiredPinged = root.expiredLanes & pinged;
      next =
        expiredPinged !== NoLanes
          ? expiredPinged
          : getHighestPriorityLanes(pinged);
    }
  }

  if (next === NoLanes) return NoLanes;

  if (
    wipLanes !== NoLanes &&
    wipLanes !== next &&
    !includesSomeLane(root.expiredLanes, wipLanes) &&
    getHighestPriorityLane(next) >= getHighestPriorityLane(wipLanes)
  ) {
    return wipLanes;
  }

  return getEntangledLanes(root, next);
}

export function getEntangledLanes(root: LaneRoot, lanes: Lanes): Lanes {
  let entangled = lanes;
  let visited = NoLanes;
  let laneSet = entangled & root.entangledLanes;

  while (laneSet !== NoLanes) {
    const index = laneToIndex(laneSet);
    const lane = 1 << index;
    entangled |= root.entanglements[index];
    visited |= lane;
    laneSet = entangled & root.entangledLanes & ~visited;
  }

  return entangled;
}

export function markRootUpdated(root: LaneRoot, lane: Lane): void {
  root.pendingLanes |= lane;

  if (lane !== IdleLane) {
    root.suspendedLanes = NoLanes;
    root.pingedLanes = NoLanes;
  }
}

export function markRootFinished(root: LaneRoot, remainingLanes: Lanes): void {
  const noLongerPending = root.pendingLanes & ~remainingLanes;
  root.pendingLanes = remainingLanes;
  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;
  root.expiredLanes &= remainingLanes;
  root.entangledLanes &= remainingLanes;

  let lanes = noLongerPending;
  while (lanes !== NoLanes) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;
    root.entanglements[index] = NoLanes;
    root.expirationTimes[index] = NoTimestamp;
    lanes &= ~lane;
  }
}

export function markRootSuspended(root: LaneRoot, lanes: Lanes): void {
  root.suspendedLanes |= lanes;
  root.pingedLanes &= ~lanes;

  let laneSet = lanes;
  while (laneSet !== NoLanes) {
    const index = laneToIndex(laneSet);
    const lane = 1 << index;
    root.expirationTimes[index] = NoTimestamp;
    laneSet &= ~lane;
  }
}

export function markRootPinged(root: LaneRoot, lanes: Lanes): void {
  root.pingedLanes |= root.suspendedLanes & lanes;
}

export function markRootEntangled(root: LaneRoot, lanes: Lanes): void {
  root.entangledLanes |= lanes;

  let laneSet = lanes;
  while (laneSet !== NoLanes) {
    const index = laneToIndex(laneSet);
    const lane = 1 << index;
    root.entanglements[index] |= lanes;
    laneSet &= ~lane;
  }
}

export function markStarvedLanesAsExpired(
  root: LaneRoot,
  currentTime: number,
): void {
  let lanes = root.pendingLanes & ~RetryLanes;

  while (lanes !== NoLanes) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;
    const expiration = root.expirationTimes[index];

    if (expiration === NoTimestamp) {
      if (
        !includesSomeLane(root.suspendedLanes, lane) ||
        includesSomeLane(root.pingedLanes, lane)
      ) {
        root.expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expiration <= currentTime) {
      root.expiredLanes |= lane;
    }

    lanes &= ~lane;
  }
}

export function claimNextTransitionLane(): Lane {
  const lane = nextTransitionLane;
  nextTransitionLane <<= 1;

  if (!includesSomeLane(TransitionLanes, nextTransitionLane)) {
    nextTransitionLane = TransitionLane1;
  }

  return lane;
}

export function claimNextRetryLane(): Lane {
  const lane = nextRetryLane;
  nextRetryLane <<= 1;

  if (!includesSomeLane(RetryLanes, nextRetryLane)) {
    nextRetryLane = RetryLane1;
  }

  return lane;
}

export function isSyncLane(lane: Lane): boolean {
  return includesSomeLane(SyncHydrationLane | SyncLane, lane);
}

export function includesOnlyTransitions(lanes: Lanes): boolean {
  return (lanes & AllTransitionLanes) === lanes;
}

export function getLanePriority(lane: Lane): LanePriority {
  if (includesSomeLane(SyncHydrationLane | SyncLane, lane)) return "sync";
  if (
    includesSomeLane(InputContinuousHydrationLane | InputContinuousLane, lane)
  ) {
    return "input";
  }
  if (
    includesSomeLane(
      DefaultHydrationLane | DefaultLane | SelectiveHydrationLane,
      lane,
    )
  ) {
    return "default";
  }
  if (includesSomeLane(GestureLane, lane)) return "gesture";
  if (includesSomeLane(AllTransitionLanes | TransitionHydrationLane, lane)) {
    return "transition";
  }
  if (includesSomeLane(RetryLanes, lane)) return "retry";
  if (includesSomeLane(DeferredLane, lane)) return "deferred";
  if (includesSomeLane(OffscreenLane, lane)) return "offscreen";
  return "idle";
}

// Mask checks directly instead of via getLanePriority's string names, so the
// name table stays out of production bundles (getLanePriority survives for
// tests and diagnostics only). `lane` is a single bit (highest-priority
// lane), so merging the groups is exact.
export function getLaneSchedulerPriority(lane: Lane): PriorityLevel {
  if (includesSomeLane(SyncHydrationLane | SyncLane, lane)) {
    return ImmediatePriority;
  }
  if (
    includesSomeLane(
      InputContinuousHydrationLane | InputContinuousLane | GestureLane,
      lane,
    )
  ) {
    return UserBlockingPriority;
  }
  // SelectiveHydrationLane is non-idle work (event-triggered hydration of a
  // dehydrated boundary): schedule it at Normal like React, or it starves
  // behind every transition and never gets a scheduler timeout.
  if (
    includesSomeLane(
      DefaultHydrationLane |
        DefaultLane |
        AllTransitionLanes |
        TransitionHydrationLane |
        SelectiveHydrationLane,
      lane,
    )
  ) {
    return NormalPriority;
  }
  if (includesSomeLane(RetryLanes, lane)) return LowPriority;
  return IdlePriority;
}

export function requestUpdateLane(): Lane {
  if (currentUpdateLane === DefaultLane && asyncTransitionLanes !== NoLanes) {
    return getHighestPriorityLane(asyncTransitionLanes);
  }

  return currentUpdateLane;
}

export function runWithPriority<T>(lane: Lane, callback: () => T): T {
  const previousLane = currentUpdateLane;
  currentUpdateLane = lane;

  try {
    return callback();
  } finally {
    currentUpdateLane = previousLane;
  }
}

export function runWithTransition<T>(callback: () => T): T {
  const lane = includesSomeLane(AllTransitionLanes, currentUpdateLane)
    ? currentUpdateLane
    : claimNextTransitionLane();

  return runWithTransitionLane(lane, callback);
}

export function runWithTransitionLane<T>(lane: Lane, callback: () => T): T {
  const result = runWithPriority(lane, callback);
  if (isThenable(result)) {
    const release = trackAsyncTransitionLane(lane);
    result.then(release, release);
  }

  return result;
}

function trackAsyncTransitionLane(lane: Lane): () => void {
  const index = laneToIndex(lane);
  asyncTransitionLaneCounts[index] += 1;
  asyncTransitionLanes |= lane;

  return () => releaseAsyncTransitionLane(lane, index);
}

function releaseAsyncTransitionLane(lane: Lane, index: number): void {
  asyncTransitionLaneCounts[index] = Math.max(
    0,
    asyncTransitionLaneCounts[index] - 1,
  );

  if (asyncTransitionLaneCounts[index] === 0) {
    asyncTransitionLanes &= ~lane;
  }
}

function computeExpirationTime(lane: Lane, currentTime: number): number {
  if (
    includesSomeLane(
      SyncHydrationLane |
        SyncLane |
        InputContinuousHydrationLane |
        InputContinuousLane |
        GestureLane,
      lane,
    )
  ) {
    return currentTime + syncLaneExpirationMs;
  }

  if (
    includesSomeLane(
      DefaultHydrationLane |
        DefaultLane |
        TransitionHydrationLane |
        AllTransitionLanes,
      lane,
    )
  ) {
    return currentTime + transitionLaneExpirationMs;
  }

  return NoTimestamp;
}

function laneToIndex(lanes: Lanes): number {
  return 31 - Math.clz32(lanes);
}
