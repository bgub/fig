import type {
  Props,
  ViewTransitionClass,
  ViewTransitionProps,
} from "@bgub/fig";
import type {
  ReconcilerCommitResult,
  ReconcilerCommitCoordinator,
} from "./commit-coordinator.ts";
import {
  ActivityTag,
  HostTag,
  PortalTag,
  ViewTransitionTag,
} from "./fiber-tags.ts";
import { walkFiberForest, walkFiberSubtree } from "./fiber-traversal.ts";
import {
  AdoptedFlag,
  DeletionFlag,
  HoistedStaticFlag,
  HostUpdateMask,
  HydrationFlag,
  MutationMask,
  PlacementFlag,
  ViewTransitionStaticFlag,
} from "./fiber-work.ts";
import {
  AllTransitionLanes,
  DeferredLane,
  IdleLane,
  NoLanes,
  RetryLanes,
} from "./lanes.ts";
import type {
  ViewTransitionPlannerFiber as PlannerFiber,
  ViewTransitionPlannerRoot as PlannerRoot,
  ViewTransitionPlannerState as ViewTransitionState,
} from "./view-transition-planner-types.ts";
declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export type ViewTransitionCommitResult = ReconcilerCommitResult;

export interface ViewTransitionSurfaceMeasurement {
  // Width/height changes of statically positioned surfaces relayout their
  // parent; absolutely positioned ones do not.
  absolutelyPositioned: boolean;
  height: number;
  inViewport: boolean;
  width: number;
  x: number;
  y: number;
}

export interface ViewTransitionMutationResult {
  canceledNames: string[];
  cancelRootSnapshot: boolean;
}

export interface ViewTransitionHostConfig<Container, Instance> {
  commit(
    this: void,
    container: Container,
    prepareSnapshot: () => void,
    mutate: () => ViewTransitionMutationResult,
    cleanup: () => void,
  ): ViewTransitionCommitResult;
  apply(
    this: void,
    instance: Instance,
    name: string,
    className: string | null,
  ): void;
  restore(this: void, instance: Instance, props: Props): void;
  measure?(
    this: void,
    instance: Instance,
  ): ViewTransitionSurfaceMeasurement | null;
  suspend?(this: void, container: Container, onFinished: () => void): boolean;
}

type ViewTransitionPhase = "enter" | "exit" | "share" | "update";

interface ViewTransitionSurface<Instance> {
  boundary: PlannerFiber<Instance>;
  className: string | null;
  instance: Instance;
  measurement: ViewTransitionSurfaceMeasurement | null;
  mustAnimate: boolean;
  name: string;
  phase: ViewTransitionPhase;
  props: Props;
  skipped: boolean;
}

interface ViewTransitionPlan<Instance> {
  newSurfaces: ViewTransitionSurface<Instance>[];
  oldSurfaces: ViewTransitionSurface<Instance>[];
  rootAffected: boolean;
}

const ViewTransitionEligibleLanes =
  AllTransitionLanes | RetryLanes | DeferredLane | IdleLane;

export function createViewTransitionCommitCoordinator<Container, Instance>(
  host: ViewTransitionHostConfig<Container, Instance>,
): ReconcilerCommitCoordinator<Container, Instance> {
  let autoNameCounter = 0;

  function isEligible(root: PlannerRoot<Container, Instance>): boolean {
    return (
      !root.clearContainerBeforeCommit &&
      root.renderLanes !== NoLanes &&
      (root.renderLanes & ~ViewTransitionEligibleLanes) === NoLanes
    );
  }

  function preparePlan(
    root: PlannerRoot<Container, Instance>,
    finishedWork: PlannerFiber<Instance>,
  ): ViewTransitionPlan<Instance> | null {
    if (!isEligible(root)) return null;
    if (
      (finishedWork.subtreeFlags & ViewTransitionStaticFlag) === 0 &&
      !root.needsCommitDeletions
    ) {
      return null;
    }
    const plan: ViewTransitionPlan<Instance> = {
      newSurfaces: [],
      oldSurfaces: [],
      rootAffected: false,
    };
    const exitsByName = new Map<string, PlannerFiber<Instance>>();

    if (root.needsCommitDeletions) {
      collectDeletedViewTransitions(root, finishedWork, plan, exitsByName);
    }
    const changedBoundaries = attributeQueuedHostUpdates(root, plan);
    collectFinishedViewTransitions(
      finishedWork.child,
      false,
      false,
      false,
      changedBoundaries,
      plan,
      exitsByName,
    );
    if (__DEV__ && !plan.rootAffected && devFlagRootAffected(finishedWork)) {
      throw new Error(
        "Fig internal parity error: commit-queue attribution missed a " +
          "mutation outside view-transition boundaries (rootAffected).",
      );
    }

    if (plan.oldSurfaces.length === 0 && plan.newSurfaces.length === 0) {
      return null;
    }

    if (__DEV__) warnOnDuplicateViewTransitionNames(plan);
    return plan;
  }

  function warnOnDuplicateViewTransitionNames(
    plan: ViewTransitionPlan<Instance>,
  ): void {
    for (const surfaces of [plan.oldSurfaces, plan.newSurfaces]) {
      const owners = new Map<string, PlannerFiber<Instance>>();
      for (const surface of surfaces) {
        const owner = owners.get(surface.name);
        if (owner !== undefined && owner !== surface.boundary) {
          console.error(
            `Multiple <ViewTransition> boundaries resolved to the name ` +
              `"${surface.name}" in one commit. The browser skips the ` +
              "entire transition when a view-transition-name is duplicated; " +
              "give each simultaneously mounted boundary a distinct name.",
          );
        }
        owners.set(surface.name, surface.boundary);
      }
    }
  }

  function collectDeletedViewTransitions(
    root: PlannerRoot<Container, Instance>,
    node: PlannerFiber<Instance>,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, PlannerFiber<Instance>>,
  ): void {
    let collected = 0;
    for (const cursor of root.commitIndex) {
      if (cursor.deletions === null) continue;
      if (__DEV__) collected += 1;
      for (const deletion of cursor.deletions) {
        collectDeletedViewTransitionFiber(deletion, plan, exitsByName, true);
      }
    }

    if (__DEV__) {
      let expected = 0;
      walkFiberSubtree(node, (cursor) => {
        if (cursor.deletions !== null) expected += 1;
        return (cursor.subtreeFlags & DeletionFlag) !== 0;
      });
      if (collected !== expected) {
        throw new Error(
          "Fig internal parity error: the commit index collected deleted " +
            `view transitions from ${collected} fiber(s) where the tree ` +
            `walk found ${expected}.`,
        );
      }
    }
  }

  function collectDeletedViewTransitionFiber(
    cursor: PlannerFiber<Instance>,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, PlannerFiber<Instance>>,
    collectExit: boolean,
  ): void {
    if (cursor.tag === PortalTag || isHiddenBoundary(cursor)) return;

    if (cursor.tag === ViewTransitionTag) {
      if (explicitViewTransitionName(cursor) !== null) {
        exitsByName.set(viewTransitionName(cursor), cursor);
      }
      if (collectExit) {
        collectViewTransitionSurfaces(
          cursor,
          "exit",
          plan.oldSurfaces,
          "committed",
        );
      }
      for (let child = cursor.child; child !== null; child = child.sibling) {
        collectDeletedViewTransitionFiber(child, plan, exitsByName, false);
      }
      return;
    }

    if ((cursor.subtreeFlags & ViewTransitionStaticFlag) === 0) return;
    for (let child = cursor.child; child !== null; child = child.sibling) {
      collectDeletedViewTransitionFiber(child, plan, exitsByName, collectExit);
    }
  }

  function attributeQueuedHostUpdates(
    root: PlannerRoot<Container, Instance>,
    plan: ViewTransitionPlan<Instance>,
  ): Set<PlannerFiber<Instance>> | null {
    let changed: Set<PlannerFiber<Instance>> | null = null;

    for (const entry of root.commitIndex) {
      if ((entry.flags & HostUpdateMask) === 0) continue;
      let sawPortal = false;
      let boundary: PlannerFiber<Instance> | null = null;
      for (let parent = entry.return; parent !== null; parent = parent.return) {
        if (parent.tag === ViewTransitionTag) {
          boundary = parent;
          break;
        }
        if (parent.tag === PortalTag) sawPortal = true;
      }
      if (boundary === null) {
        plan.rootAffected = true;
      } else if (!sawPortal) {
        (changed ??= new Set()).add(boundary);
      }
    }

    return changed;
  }

  function devFlagRootAffected(node: PlannerFiber<Instance>): boolean {
    let affected = false;
    walkFiberSubtree(node, (cursor) => {
      if (cursor === node) return true;
      const containsViewTransition =
        cursor.tag === ViewTransitionTag ||
        (cursor.subtreeFlags & ViewTransitionStaticFlag) !== 0;
      if (!containsViewTransition) {
        if (devSubtreeHasMutations(cursor)) affected = true;
        return false;
      }
      if (isStablyHiddenBoundary(cursor)) return false;
      if (cursor.tag === ViewTransitionTag) return false;
      if (cursor.tag === PortalTag) return false;
      if ((cursor.flags & (MutationMask | DeletionFlag)) !== 0) affected = true;
      return true;
    });
    return affected;
  }

  function devSubtreeHasMutations(node: PlannerFiber<Instance>): boolean {
    let found = false;
    walkFiberSubtree(node, (cursor) => {
      if ((cursor.flags & (MutationMask | DeletionFlag)) !== 0) found = true;
      return !found;
    });
    return found;
  }

  function collectFinishedViewTransitions(
    node: PlannerFiber<Instance> | null,
    placed: boolean,
    insideBoundary: boolean,
    ancestorLayoutChanged: boolean,
    changedBoundaries: Set<PlannerFiber<Instance>> | null,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, PlannerFiber<Instance>>,
  ): void {
    let layoutChanged = ancestorLayoutChanged;
    for (
      let cursor = node;
      !layoutChanged && cursor !== null;
      cursor = cursor.sibling
    ) {
      if (
        (cursor.flags & PlacementFlag) !== 0 &&
        (cursor.alternate !== null || (cursor.flags & AdoptedFlag) !== 0)
      ) {
        layoutChanged = true;
      }
    }

    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      const cursorPlaced = placed || (cursor.flags & PlacementFlag) !== 0;
      const containsViewTransition =
        cursor.tag === ViewTransitionTag ||
        (cursor.subtreeFlags & ViewTransitionStaticFlag) !== 0;

      if (!containsViewTransition) {
        if (
          !insideBoundary &&
          ((cursor.flags | cursor.subtreeFlags) &
            (MutationMask | DeletionFlag)) !==
            0
        ) {
          plan.rootAffected = true;
        }
        continue;
      }
      if (isStablyHiddenBoundary(cursor)) continue;

      if (cursor.tag === ViewTransitionTag) {
        if (
          !cursorPlaced &&
          ((cursor.flags | cursor.subtreeFlags) & HydrationFlag) !== 0
        ) {
          continue;
        }
        if (cursorPlaced) {
          const pairedExit = exitsByName.get(viewTransitionName(cursor));
          if (pairedExit !== undefined) {
            if (!insideBoundary) plan.rootAffected = true;
            collectViewTransitionPair(plan, pairedExit, cursor);
            exitsByName.delete(viewTransitionName(cursor));
          } else if (cursor.alternate !== null) {
            collectViewTransitionSurfaces(
              cursor.alternate,
              "update",
              plan.oldSurfaces,
              "committed",
              false,
            );
            collectViewTransitionSurfaces(
              cursor,
              "update",
              plan.newSurfaces,
              "finished",
              false,
            );
          } else {
            if (!insideBoundary) plan.rootAffected = true;
            collectViewTransitionSurfaces(
              cursor,
              "enter",
              plan.newSurfaces,
              "finished",
            );
          }
          collectAppearingPairViewTransitions(cursor.child, plan, exitsByName);
          continue;
        }

        const current = cursor.alternate ?? cursor;
        const contentChanged = viewTransitionChangedOutsideNested(
          cursor,
          changedBoundaries,
        );
        if (__DEV__) {
          const expected = devViewTransitionChangedOutsideNested(cursor);
          if (contentChanged !== expected) {
            throw new Error(
              "Fig internal parity error: commit-queue attribution " +
                `classified a view-transition boundary as ${contentChanged ? "changed" : "unchanged"} ` +
                "where own-fiber flags disagree.",
            );
          }
        }
        if (contentChanged || layoutChanged) {
          collectViewTransitionSurfaces(
            current,
            "update",
            plan.oldSurfaces,
            "committed",
            contentChanged,
          );
          collectViewTransitionSurfaces(
            cursor,
            "update",
            plan.newSurfaces,
            "finished",
            contentChanged,
          );
        }
        collectFinishedViewTransitions(
          cursor.child,
          cursorPlaced,
          true,
          contentChanged || layoutChanged,
          changedBoundaries,
          plan,
          exitsByName,
        );
        continue;
      }

      if (cursor.tag !== PortalTag) {
        if (
          !insideBoundary &&
          (cursor.flags & (MutationMask | DeletionFlag)) !== 0
        ) {
          plan.rootAffected = true;
        }
        collectFinishedViewTransitions(
          cursor.child,
          cursorPlaced,
          insideBoundary,
          layoutChanged || (cursor.flags & (MutationMask | DeletionFlag)) !== 0,
          changedBoundaries,
          plan,
          exitsByName,
        );
      }
    }
  }

  function collectAppearingPairViewTransitions(
    node: PlannerFiber<Instance> | null,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, PlannerFiber<Instance>>,
  ): void {
    if (exitsByName.size === 0) return;

    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if (cursor.tag === PortalTag || isStablyHiddenBoundary(cursor)) continue;

      if (cursor.tag === ViewTransitionTag) {
        const pairedExit =
          explicitViewTransitionName(cursor) !== null
            ? exitsByName.get(viewTransitionName(cursor))
            : undefined;
        if (pairedExit !== undefined) {
          collectViewTransitionPair(plan, pairedExit, cursor);
          exitsByName.delete(viewTransitionName(cursor));
        }
      }

      collectAppearingPairViewTransitions(cursor.child, plan, exitsByName);
    }
  }

  function collectViewTransitionPair(
    plan: ViewTransitionPlan<Instance>,
    oldBoundary: PlannerFiber<Instance>,
    newBoundary: PlannerFiber<Instance>,
  ): void {
    removeViewTransitionSurfaces(plan.oldSurfaces, oldBoundary);
    collectViewTransitionSurfaces(
      oldBoundary,
      "share",
      plan.oldSurfaces,
      "committed",
    );
    collectViewTransitionSurfaces(
      newBoundary,
      "share",
      plan.newSurfaces,
      "finished",
    );
  }

  function isHiddenBoundary(node: PlannerFiber<Instance>): boolean {
    return node.tag === ActivityTag && node.props.mode === "hidden";
  }

  function isStablyHiddenBoundary(node: PlannerFiber<Instance>): boolean {
    if (!isHiddenBoundary(node)) return false;
    const current = node.alternate;
    return (
      current === null ||
      (current.memoizedProps ?? current.props).mode === "hidden"
    );
  }

  function viewTransitionChangedOutsideNested(
    boundary: PlannerFiber<Instance>,
    changedBoundaries: Set<PlannerFiber<Instance>> | null,
  ): boolean {
    if ((boundary.flags & (MutationMask | DeletionFlag)) !== 0) return true;
    if (changedBoundaries?.has(boundary) === true) return true;
    return subtreeChangedOutsideNested(boundary.child);
  }

  function devViewTransitionChangedOutsideNested(
    boundary: PlannerFiber<Instance>,
  ): boolean {
    if ((boundary.flags & (MutationMask | DeletionFlag)) !== 0) return true;
    let changed = false;
    walkFiberForest(boundary.child, (cursor) => {
      if (changed || cursor.tag === PortalTag) return false;
      if (cursor.tag === ViewTransitionTag) return false;
      if ((cursor.flags & (MutationMask | DeletionFlag)) !== 0) changed = true;
      return !changed;
    });
    return changed;
  }

  function subtreeChangedOutsideNested(
    node: PlannerFiber<Instance> | null,
  ): boolean {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if (cursor.tag === PortalTag || cursor.tag === ViewTransitionTag)
        continue;
      if ((cursor.flags & (MutationMask | DeletionFlag)) !== 0) return true;
      if ((cursor.subtreeFlags & (MutationMask | DeletionFlag)) === 0) continue;
      if (subtreeChangedOutsideNested(cursor.child)) return true;
    }
    return false;
  }

  function removeViewTransitionSurfaces(
    surfaces: ViewTransitionSurface<Instance>[],
    boundary: PlannerFiber<Instance>,
  ): void {
    for (let index = surfaces.length - 1; index >= 0; index -= 1) {
      if (surfaces[index].boundary === boundary) surfaces.splice(index, 1);
    }
  }

  function collectViewTransitionSurfaces(
    boundary: PlannerFiber<Instance>,
    phase: ViewTransitionPhase,
    surfaces: ViewTransitionSurface<Instance>[],
    propsSource: "committed" | "finished",
    mustAnimate = true,
  ): void {
    const className = viewTransitionClass(boundary.props, phase);
    if (className === "none") return;

    const name = viewTransitionName(boundary);
    let index = 0;

    const collect = (node: PlannerFiber<Instance> | null): void => {
      for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
        if (cursor.tag === PortalTag) continue;
        if (cursor.tag === ViewTransitionTag) continue;
        if (cursor.tag === HostTag) {
          if ((cursor.flags & HoistedStaticFlag) === 0) {
            surfaces.push({
              boundary,
              className,
              instance: cursor.stateNode as Instance,
              measurement: null,
              mustAnimate,
              name: index === 0 ? name : `${name}_${index}`,
              phase,
              props: viewTransitionSurfaceProps(cursor, propsSource),
              skipped: false,
            });
            index += 1;
          }
          continue;
        }
        collect(cursor.child);
      }
    };

    collect(boundary.child);
  }

  function viewTransitionSurfaceProps(
    node: PlannerFiber<Instance>,
    source: "committed" | "finished",
  ): Props {
    if (source === "committed") {
      return node.committedProps ?? node.memoizedProps ?? node.props;
    }
    return node.memoizedProps ?? node.props;
  }

  function viewTransitionName(node: PlannerFiber<Instance>): string {
    const props = node.props as ViewTransitionProps;
    if (props.name !== undefined && props.name !== "auto") return props.name;

    const state = node.stateNode as ViewTransitionState;
    state.autoName ??= `fig-vt-${autoNameCounter++}`;
    return state.autoName;
  }

  function explicitViewTransitionName(
    node: PlannerFiber<Instance>,
  ): string | null {
    const name = (node.props as ViewTransitionProps).name;
    return name === undefined || name === "auto" ? null : name;
  }

  function viewTransitionClass(
    props: Props,
    phase: ViewTransitionPhase,
  ): ViewTransitionClass | null {
    const viewTransitionProps = props as ViewTransitionProps;
    const phaseClass = viewTransitionProps[phase];
    const className =
      phaseClass === undefined ? viewTransitionProps.default : phaseClass;

    return className === undefined || className === "auto" ? null : className;
  }

  function applyOldViewTransitionSurfaces(
    plan: ViewTransitionPlan<Instance>,
  ): void {
    const measure = host.measure;

    for (const surface of plan.oldSurfaces) {
      surface.measurement = measure?.(surface.instance) ?? null;
      if (
        surface.phase === "exit" &&
        surface.measurement !== null &&
        !surface.measurement.inViewport
      ) {
        surface.skipped = true;
        continue;
      }
      host.apply(surface.instance, surface.name, surface.className);
    }
  }

  function resolveViewTransitionPlan(
    plan: ViewTransitionPlan<Instance>,
  ): ViewTransitionMutationResult {
    const result: ViewTransitionMutationResult = {
      canceledNames: [],
      cancelRootSnapshot: false,
    };
    const measure = host.measure;

    const oldByName = new Map<string, ViewTransitionSurface<Instance>>();
    for (const surface of plan.oldSurfaces) {
      if (!surface.skipped) oldByName.set(surface.name, surface);
    }

    let rootAffected = plan.rootAffected;
    const newNames = new Set<string>();

    for (const surface of plan.newSurfaces) {
      newNames.add(surface.name);
      const measurement = measure?.(surface.instance) ?? null;

      if (surface.phase === "enter") {
        if (measurement !== null && !measurement.inViewport) {
          surface.skipped = true;
          continue;
        }
        host.apply(surface.instance, surface.name, surface.className);
        continue;
      }

      if (surface.phase === "update") {
        const oldSurface = oldByName.get(surface.name);
        const before = oldSurface?.measurement ?? null;
        if (before !== null && measurement !== null) {
          const moved =
            before.x !== measurement.x ||
            before.y !== measurement.y ||
            before.width !== measurement.width ||
            before.height !== measurement.height;
          const offscreen = !before.inViewport && !measurement.inViewport;

          if (offscreen || (!surface.mustAnimate && !moved)) {
            surface.skipped = true;
            host.restore(surface.instance, surface.props);
            if (oldSurface !== undefined) {
              oldSurface.skipped = true;
              result.canceledNames.push(surface.name);
            }
            continue;
          }
          if (
            (before.width !== measurement.width ||
              before.height !== measurement.height) &&
            !measurement.absolutelyPositioned
          ) {
            rootAffected = true;
          }
        }
      }

      host.apply(surface.instance, surface.name, surface.className);
    }

    for (const [name, surface] of oldByName) {
      if (surface.phase === "update" && !newNames.has(name)) {
        rootAffected = true;
      }
    }

    result.cancelRootSnapshot = !rootAffected;
    return result;
  }

  function restoreViewTransitionSurfaces(
    plan: ViewTransitionPlan<Instance>,
  ): void {
    const propsByInstance = new Map<Instance, Props>();
    for (const surface of plan.oldSurfaces) {
      propsByInstance.set(surface.instance, surface.props);
    }
    for (const surface of plan.newSurfaces) {
      propsByInstance.set(surface.instance, surface.props);
    }

    for (const [instance, props] of propsByInstance) {
      host.restore(instance, props);
    }
  }

  function emptyMutationResult(): ViewTransitionMutationResult {
    return { canceledNames: [], cancelRootSnapshot: false };
  }

  return {
    name: "view-transitions",
    capabilities: ["view-transitions"],
    suspend(rootIdentity, onReady) {
      const root = rootIdentity as PlannerRoot<Container, Instance>;
      return (
        isEligible(root) && host.suspend?.(root.container, onReady) === true
      );
    },
    commit(context) {
      const root = context.root as PlannerRoot<Container, Instance>;
      const finishedWork = context.finishedWork as PlannerFiber<Instance>;
      const plan = preparePlan(root, finishedWork);
      if (plan === null) return false;
      let didRunMutation = false;

      return host.commit(
        context.container,
        () => applyOldViewTransitionSurfaces(plan),
        () => {
          didRunMutation = true;
          return (
            context.runMutation(() => resolveViewTransitionPlan(plan)) ??
            emptyMutationResult()
          );
        },
        () => {
          try {
            restoreViewTransitionSurfaces(plan);
          } finally {
            // The host also cleans up prepared names when its native commit
            // fails before mutation so the reconciler can fall back normally.
            if (didRunMutation) context.captureFinished();
          }
        },
      );
    },
  };
}
