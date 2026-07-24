import type {
  Props,
  ViewTransitionCallback,
  ViewTransitionClass,
  ViewTransitionEvent,
  ViewTransitionPhase,
  ViewTransitionProps,
  ViewTransitionSurface as PublicViewTransitionSurface,
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
import { getRootTransitionTypes } from "./transition-types.ts";
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

export interface ViewTransitionSurfaceSnapshots {
  readonly old: boolean;
  readonly new: boolean;
}

export interface ViewTransitionHostConfig<Container, Instance> {
  commit(
    this: void,
    container: Container,
    types: readonly string[],
    prepareSnapshot: () => void,
    mutate: () => ViewTransitionMutationResult,
    ready: (active: boolean) => void,
    finished: () => void,
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
  createSurface?(
    this: void,
    instance: Instance,
    name: string,
    snapshots: ViewTransitionSurfaceSnapshots,
  ): PublicViewTransitionSurface;
  suspend?(this: void, container: Container, onFinished: () => void): boolean;
}

interface ViewTransitionSurface<Instance> {
  boundary: PlannerFiber;
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
  types: string[];
}

interface ViewTransitionCollection<Instance> {
  changedBoundaries: Set<PlannerFiber> | null;
  exitsByName: Map<string, PlannerFiber>;
  plan: ViewTransitionPlan<Instance>;
}

const ViewTransitionEligibleLanes =
  AllTransitionLanes | RetryLanes | DeferredLane | IdleLane;

export function createViewTransitionCommitCoordinator<Container, Instance>(
  host: ViewTransitionHostConfig<Container, Instance>,
): ReconcilerCommitCoordinator<Container, Instance> {
  let autoNameCounter = 0;

  function isEligible(root: PlannerRoot<Container>): boolean {
    return (
      !root.clearContainerBeforeCommit &&
      root.renderLanes !== NoLanes &&
      (root.renderLanes & ~ViewTransitionEligibleLanes) === NoLanes
    );
  }

  function preparePlan(
    root: PlannerRoot<Container>,
    finishedWork: PlannerFiber,
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
      types: getRootTransitionTypes(root, root.renderLanes),
    };
    const collection: ViewTransitionCollection<Instance> = {
      changedBoundaries: null,
      exitsByName: new Map(),
      plan,
    };

    if (root.needsCommitDeletions) {
      collectDeletedViewTransitions(root, finishedWork, collection);
    }
    collection.changedBoundaries = attributeQueuedHostUpdates(root, plan);
    collectFinishedViewTransitions(
      finishedWork.child,
      false,
      false,
      false,
      collection,
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
      const owners = new Map<string, PlannerFiber>();
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
    root: PlannerRoot<Container>,
    node: PlannerFiber,
    collection: ViewTransitionCollection<Instance>,
  ): void {
    let collected = 0;
    for (const cursor of root.commitIndex) {
      if (cursor.deletions === null) continue;
      if (__DEV__) collected += 1;
      for (const deletion of cursor.deletions) {
        collectDeletedViewTransitionFiber(deletion, collection, true);
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
    cursor: PlannerFiber,
    collection: ViewTransitionCollection<Instance>,
    collectExit: boolean,
  ): void {
    if (cursor.tag === PortalTag || isHiddenBoundary(cursor)) return;

    if (cursor.tag === ViewTransitionTag) {
      const name = explicitViewTransitionName(cursor);
      if (name !== null) collection.exitsByName.set(name, cursor);
      if (collectExit) {
        collectViewTransitionSurfaces(
          cursor,
          "exit",
          collection.plan.oldSurfaces,
          "committed",
        );
      }
      for (let child = cursor.child; child !== null; child = child.sibling) {
        collectDeletedViewTransitionFiber(child, collection, false);
      }
      return;
    }

    if ((cursor.subtreeFlags & ViewTransitionStaticFlag) === 0) return;
    for (let child = cursor.child; child !== null; child = child.sibling) {
      collectDeletedViewTransitionFiber(child, collection, collectExit);
    }
  }

  function attributeQueuedHostUpdates(
    root: PlannerRoot<Container>,
    plan: ViewTransitionPlan<Instance>,
  ): Set<PlannerFiber> | null {
    let changed: Set<PlannerFiber> | null = null;

    for (const entry of root.commitIndex) {
      if ((entry.flags & HostUpdateMask) === 0) continue;
      let sawPortal = false;
      let boundary: PlannerFiber | null = null;
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

  function devFlagRootAffected(node: PlannerFiber): boolean {
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

  function devSubtreeHasMutations(node: PlannerFiber): boolean {
    let found = false;
    walkFiberSubtree(node, (cursor) => {
      if ((cursor.flags & (MutationMask | DeletionFlag)) !== 0) found = true;
      return !found;
    });
    return found;
  }

  function collectFinishedViewTransitions(
    node: PlannerFiber | null,
    placed: boolean,
    insideBoundary: boolean,
    ancestorLayoutChanged: boolean,
    collection: ViewTransitionCollection<Instance>,
  ): void {
    const { changedBoundaries, exitsByName, plan } = collection;
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
          const name = viewTransitionName(cursor);
          const pairedExit = exitsByName.get(name);
          if (pairedExit !== undefined) {
            if (!insideBoundary) plan.rootAffected = true;
            collectViewTransitionPair(plan, pairedExit, cursor);
            exitsByName.delete(name);
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
          collectAppearingPairViewTransitions(cursor.child, collection);
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
          collection,
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
          collection,
        );
      }
    }
  }

  function collectAppearingPairViewTransitions(
    node: PlannerFiber | null,
    collection: ViewTransitionCollection<Instance>,
  ): void {
    const { exitsByName, plan } = collection;
    if (exitsByName.size === 0) return;

    walkFiberForest(node, (cursor) => {
      if (exitsByName.size === 0) return false;
      if (cursor.tag === PortalTag || isStablyHiddenBoundary(cursor)) {
        return false;
      }

      if (cursor.tag === ViewTransitionTag) {
        const name = explicitViewTransitionName(cursor);
        if (name !== null) {
          const pairedExit = exitsByName.get(name);
          if (pairedExit !== undefined) {
            collectViewTransitionPair(plan, pairedExit, cursor);
            exitsByName.delete(name);
          }
        }
      }
      return true;
    });
  }

  function collectViewTransitionPair(
    plan: ViewTransitionPlan<Instance>,
    oldBoundary: PlannerFiber,
    newBoundary: PlannerFiber,
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

  function isHiddenBoundary(node: PlannerFiber): boolean {
    return node.tag === ActivityTag && node.props.mode === "hidden";
  }

  function isStablyHiddenBoundary(node: PlannerFiber): boolean {
    if (!isHiddenBoundary(node)) return false;
    const current = node.alternate;
    return (
      current === null ||
      (current.memoizedProps ?? current.props).mode === "hidden"
    );
  }

  function viewTransitionChangedOutsideNested(
    boundary: PlannerFiber,
    changedBoundaries: Set<PlannerFiber> | null,
  ): boolean {
    if ((boundary.flags & (MutationMask | DeletionFlag)) !== 0) return true;
    if (changedBoundaries?.has(boundary) === true) return true;
    return subtreeChangedOutsideNested(boundary.child);
  }

  function devViewTransitionChangedOutsideNested(
    boundary: PlannerFiber,
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

  function subtreeChangedOutsideNested(node: PlannerFiber | null): boolean {
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
    boundary: PlannerFiber,
  ): void {
    for (let index = surfaces.length - 1; index >= 0; index -= 1) {
      if (surfaces[index].boundary === boundary) surfaces.splice(index, 1);
    }
  }

  function collectViewTransitionSurfaces(
    boundary: PlannerFiber,
    phase: ViewTransitionPhase,
    surfaces: ViewTransitionSurface<Instance>[],
    propsSource: "committed" | "finished",
    mustAnimate = true,
  ): void {
    const className = viewTransitionClass(boundary.props, phase);
    if (className === "none") return;

    const name = viewTransitionName(boundary);
    let index = 0;

    walkFiberForest(boundary.child, (cursor) => {
      if (cursor.tag === PortalTag || cursor.tag === ViewTransitionTag) {
        return false;
      }
      if (cursor.tag !== HostTag) return true;
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
      return false;
    });
  }

  function viewTransitionSurfaceProps(
    node: PlannerFiber,
    source: "committed" | "finished",
  ): Props {
    if (source === "committed") {
      return node.committedProps ?? node.memoizedProps ?? node.props;
    }
    return node.memoizedProps ?? node.props;
  }

  function viewTransitionName(node: PlannerFiber): string {
    const props = node.props as ViewTransitionProps;
    if (props.name !== undefined && props.name !== "auto") return props.name;

    const state = node.stateNode as ViewTransitionState;
    state.autoName ??= `fig-vt-${autoNameCounter++}`;
    return state.autoName;
  }

  function explicitViewTransitionName(node: PlannerFiber): string | null {
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

  function participatingSurfaceNames(
    surfaces: ViewTransitionSurface<Instance>[],
  ): Set<string> {
    const names = new Set<string>();
    for (const surface of surfaces) {
      if (!surface.skipped) names.add(surface.name);
    }
    return names;
  }

  function dispatchViewTransitionCallbacks(
    plan: ViewTransitionPlan<Instance>,
    signal: AbortSignal,
  ): void {
    const groups = new Map<
      PlannerFiber,
      {
        callback: ViewTransitionCallback;
        surfaces: ViewTransitionSurface<Instance>[];
      }
    >();
    const collect = (surface: ViewTransitionSurface<Instance>): void => {
      if (surface.skipped) return;
      const callback = (surface.boundary.props as ViewTransitionProps)
        .onTransition;
      if (callback === undefined) return;
      const group = groups.get(surface.boundary);
      if (group === undefined) {
        groups.set(surface.boundary, { callback, surfaces: [surface] });
      } else {
        group.surfaces.push(surface);
      }
    };

    // New surfaces own enter, update, and share callbacks. Exit has no new
    // side, so its committed boundary owns the callback instead.
    for (const surface of plan.newSurfaces) collect(surface);
    for (const surface of plan.oldSurfaces) {
      if (surface.phase === "exit") collect(surface);
    }
    if (groups.size === 0) return;

    const oldNames = participatingSurfaceNames(plan.oldSurfaces);
    const newNames = participatingSurfaceNames(plan.newSurfaces);
    for (const { callback, surfaces: group } of groups.values()) {
      const surfaces = group.map((surface) => {
        const snapshots: ViewTransitionSurfaceSnapshots = {
          old: oldNames.has(surface.name),
          new: newNames.has(surface.name),
        };
        return (
          host.createSurface?.(surface.instance, surface.name, snapshots) ?? {
            name: surface.name,
          }
        );
      });
      const event: ViewTransitionEvent = {
        phase: group[0].phase,
        surfaces,
        types: plan.types,
      };
      callback(event, signal);
    }
  }

  return {
    name: "view-transitions",
    viewTransitions: true,
    suspend(rootIdentity, onReady) {
      const root = rootIdentity as PlannerRoot<Container>;
      return (
        isEligible(root) && host.suspend?.(root.container, onReady) === true
      );
    },
    commit(context) {
      const root = context.root as PlannerRoot<Container>;
      const finishedWork = context.finishedWork as PlannerFiber;
      const plan = preparePlan(root, finishedWork);
      if (plan === null) return false;
      let didRunMutation = false;
      let didFinish = false;
      let controller: AbortController | null = null;

      return host.commit(
        context.container,
        plan.types,
        () => applyOldViewTransitionSurfaces(plan),
        () => {
          didRunMutation = true;
          return (
            context.runMutation(() => resolveViewTransitionPlan(plan)) ?? {
              canceledNames: [],
              cancelRootSnapshot: false,
            }
          );
        },
        (active) => {
          try {
            restoreViewTransitionSurfaces(plan);
          } finally {
            // The host also cleans up prepared names when its native commit
            // fails before mutation so the reconciler can fall back normally.
            if (didRunMutation) context.captureFinished();
          }
          if (active && !didFinish && controller === null) {
            controller = new AbortController();
            dispatchViewTransitionCallbacks(plan, controller.signal);
          }
        },
        () => {
          didFinish = true;
          controller?.abort();
        },
      );
    },
  };
}
