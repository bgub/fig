import { describe, expect, it } from "vitest";
import {
  AllTransitionLanes,
  claimNextRetryLane,
  createLaneMap,
  DefaultLane,
  getEntangledLanes,
  getHighestPriorityLane,
  getLanePriority,
  getLaneSchedulerPriority,
  getNextLanes,
  IdleHydrationLane,
  IdleLane,
  InputContinuousLane,
  includesSomeLane,
  type LaneRoot,
  markRootEntangled,
  markRootUpdated,
  mergeLanes,
  NoLanes,
  NonIdleLanes,
  NoTimestamp,
  OffscreenLane,
  RetryLanes,
  requestUpdateLane,
  runWithPriority,
  runWithTransition,
  SelectiveHydrationLane,
  SyncLane,
  TotalLanes,
  TransitionLane1,
  TransitionLane2,
  TransitionLane3,
} from "./lanes.ts";
import { getCurrentTransitionTypes } from "./transition-types.ts";
import { NormalPriority } from "./scheduler.ts";

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

  it("schedules selective hydration as non-idle default-priority work", () => {
    expect(NonIdleLanes & SelectiveHydrationLane).toBe(SelectiveHydrationLane);
    expect(getLanePriority(SelectiveHydrationLane)).toBe("default");
    expect(getLaneSchedulerPriority(SelectiveHydrationLane)).toBe(
      NormalPriority,
    );
  });

  it("tracks scoped update priority", () => {
    expect(requestUpdateLane()).toBe(DefaultLane);

    runWithPriority(SyncLane, () => {
      expect(requestUpdateLane()).toBe(SyncLane);
    });

    expect(requestUpdateLane()).toBe(DefaultLane);
  });

  it("claims retry lanes round-robin", () => {
    const first = claimNextRetryLane();
    const claimed = [
      first,
      claimNextRetryLane(),
      claimNextRetryLane(),
      claimNextRetryLane(),
    ];

    for (const lane of claimed) {
      expect(includesSomeLane(RetryLanes, lane)).toBe(true);
    }

    expect(new Set(claimed).size).toBe(4);
    expect(claimNextRetryLane()).toBe(first);
  });

  it("tracks scoped transition priority", () => {
    runWithTransition(() => {
      const lane = requestUpdateLane();
      expect(includesSomeLane(AllTransitionLanes, lane)).toBe(true);

      runWithTransition(() => {
        expect(requestUpdateLane()).toBe(lane);
      });
    });

    expect(requestUpdateLane()).toBe(DefaultLane);
  });

  it("unions transition types within a lane and releases them with the scope", () => {
    let transitionLane = NoLanes;
    runWithTransition(
      () => {
        const lane = requestUpdateLane();
        transitionLane = lane;
        expect(getCurrentTransitionTypes(lane)).toEqual(
          new Set(["navigation"]),
        );

        runWithTransition(
          () => {
            expect(getCurrentTransitionTypes(lane)).toEqual(
              new Set(["navigation", "forward"]),
            );
          },
          { types: ["forward", "navigation"] },
        );

        expect(getCurrentTransitionTypes(lane)).toEqual(
          new Set(["navigation", "forward"]),
        );
      },
      { types: ["navigation"] },
    );

    expect(getCurrentTransitionTypes(transitionLane)).toBe(null);
  });

  it("keeps transition types active across an async scope", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let transitionLane = NoLanes;

    const pending = runWithTransition(
      async () => {
        transitionLane = requestUpdateLane();
        await gate;
        expect(requestUpdateLane()).toBe(transitionLane);
        expect(getCurrentTransitionTypes(transitionLane)).toEqual(
          new Set(["navigation"]),
        );
      },
      { types: ["navigation"] },
    );

    release();
    await pending;
    expect(getCurrentTransitionTypes(transitionLane)).toBe(null);
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

  it("does not let expired lanes bypass suspended lanes", () => {
    const laneRoot = root();
    markRootUpdated(laneRoot, SyncLane);
    markRootUpdated(laneRoot, TransitionLane1);
    laneRoot.suspendedLanes = TransitionLane1;
    laneRoot.expiredLanes = TransitionLane1;

    expect(getNextLanes(laneRoot)).toBe(SyncLane);
  });

  it("includes transitive entangled lanes", () => {
    const laneRoot = root();

    markRootEntangled(laneRoot, mergeLanes(TransitionLane1, TransitionLane2));
    markRootEntangled(laneRoot, mergeLanes(TransitionLane2, TransitionLane3));

    expect(getEntangledLanes(laneRoot, TransitionLane1)).toBe(
      TransitionLane1 | TransitionLane2 | TransitionLane3,
    );
  });
});
