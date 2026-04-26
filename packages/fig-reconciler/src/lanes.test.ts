import { describe, expect, it } from "vitest";
import {
  createLaneMap,
  DefaultLane,
  getHighestPriorityLane,
  getLanePriority,
  getNextLanes,
  IdleHydrationLane,
  IdleLane,
  InputContinuousLane,
  type LaneRoot,
  markRootEntangled,
  markRootUpdated,
  mergeLanes,
  NoLanes,
  NonIdleLanes,
  NoTimestamp,
  OffscreenLane,
  requestUpdateLane,
  runWithPriority,
  SyncLane,
  TotalLanes,
  TransitionLane1,
  TransitionLane2,
} from "./lanes.ts";

function root(): LaneRoot {
  return {
    pendingLanes: NoLanes,
    suspendedLanes: NoLanes,
    pingedLanes: NoLanes,
    expiredLanes: NoLanes,
    entangledLanes: NoLanes,
    entanglements: createLaneMap(NoLanes),
    expirationTimes: createLaneMap(NoTimestamp),
  };
}

describe("lanes", () => {
  it("uses a React-shaped 31 lane bitmask", () => {
    expect(TotalLanes).toBe(31);
    expect(IdleLane).toBe(1 << 28);
    expect(getHighestPriorityLane(DefaultLane | InputContinuousLane)).toBe(
      InputContinuousLane,
    );
    expect(getLanePriority(DefaultLane)).toBe("default");
    expect(NonIdleLanes & DefaultLane).toBe(DefaultLane);
    expect(NonIdleLanes & (IdleHydrationLane | IdleLane | OffscreenLane)).toBe(
      NoLanes,
    );
  });

  it("tracks scoped update priority", () => {
    expect(requestUpdateLane()).toBe(DefaultLane);

    runWithPriority(SyncLane, () => {
      expect(requestUpdateLane()).toBe(SyncLane);
    });

    expect(requestUpdateLane()).toBe(DefaultLane);
  });

  it("selects pending non-suspended lanes and includes entanglements", () => {
    const laneRoot = root();
    markRootUpdated(laneRoot, TransitionLane1);
    markRootUpdated(laneRoot, TransitionLane2);
    laneRoot.suspendedLanes = TransitionLane1;

    expect(getNextLanes(laneRoot)).toBe(TransitionLane2);

    markRootEntangled(laneRoot, mergeLanes(TransitionLane1, TransitionLane2));
    laneRoot.suspendedLanes = NoLanes;

    expect(getNextLanes(laneRoot)).toBe(TransitionLane1 | TransitionLane2);
  });
});
