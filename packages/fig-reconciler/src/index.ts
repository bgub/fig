import {
  type DependencyList,
  type Dispatch,
  type EffectCallback,
  type ElementType,
  type FigChild,
  type FigElement,
  type FigNode,
  Fragment,
  type HookDispatcher,
  isValidElement,
  type Props,
  type SetStateAction,
  setCurrentDispatcher,
} from "@bgub/fig";
import {
  NormalPriority,
  now,
  type ScheduledTask,
  scheduleCallback,
  shouldYieldToHost,
} from "@bgub/fig-scheduler";
import {
  createLaneMap,
  DefaultLane,
  getHighestPriorityLane,
  getLaneSchedulerPriority,
  getNextLanes,
  includesSomeLane,
  isSyncLane,
  type Lane,
  type LaneRoot,
  type Lanes,
  markRootFinished,
  markRootUpdated,
  markStarvedLanesAsExpired,
  mergeLanes,
  NoLane,
  NoLanes,
  NoTimestamp,
  requestUpdateLane,
  runWithPriority,
  SyncLane,
} from "./lanes.ts";

export * from "./lanes.ts";

type Component = (props: Props & { children?: FigNode }) => FigNode;
type HostNode<Instance, TextInstance> = Instance | TextInstance;
type Parent<Container, Instance> = Container | Instance;

export interface HostConfig<Container, Instance, TextInstance> {
  createInstance(type: string, props: Props): Instance;
  createTextInstance(text: string): TextInstance;
  insertBefore(
    parent: Parent<Container, Instance>,
    child: HostNode<Instance, TextInstance>,
    before: HostNode<Instance, TextInstance> | null,
  ): void;
  removeChild(
    parent: Parent<Container, Instance>,
    child: HostNode<Instance, TextInstance>,
  ): void;
  commitUpdate(
    instance: Instance,
    previousProps: Props,
    nextProps: Props,
  ): void;
  commitTextUpdate(text: TextInstance, value: string): void;
}

export interface FigRoot {
  render(children: FigNode): void;
  unmount(): void;
}

const RootTag = 0;
const HostTag = 1;
const TextTag = 2;
const FunctionTag = 3;
const FragmentTag = 4;
type Tag =
  | typeof RootTag
  | typeof HostTag
  | typeof TextTag
  | typeof FunctionTag
  | typeof FragmentTag;

const NoFlags = 0;
const PlacementFlag = 1 << 0;
const UpdateFlag = 1 << 1;
type Flag = number;

const ReactiveEffect = 0;
const BeforePaintEffect = 1;
const BeforeLayoutEffect = 2;
const EffectTag = Symbol("fig.effect");
type EffectPhase =
  | typeof ReactiveEffect
  | typeof BeforePaintEffect
  | typeof BeforeLayoutEffect;

interface HookUpdate<S> {
  action: SetStateAction<S>;
  lane: Lane;
  next: HookUpdate<S>;
}

interface HookQueue<S> {
  pending: HookUpdate<S> | null;
  dispatch: Dispatch<SetStateAction<S>> | null;
}

interface Hook<S = unknown> {
  kind: HookKind;
  memoizedState: S;
  baseState: S;
  baseQueue: HookUpdate<S> | null;
  queue: HookQueue<S>;
  next: Hook | null;
}

type HookKind =
  | "state"
  | "reactive"
  | "on-mount"
  | "before-paint"
  | "before-layout";

interface Effect {
  tag: typeof EffectTag;
  phase: EffectPhase;
  create: EffectCallback;
  controller: AbortController | null;
  deps: DependencyList | null;
}

interface Fiber<Container, Instance, TextInstance> {
  tag: Tag;
  type: ElementType | null;
  key: string | number | null;
  props: Props;
  memoizedProps: Props | null;
  memoizedState: Hook | null;
  stateNode:
    | HostNode<Instance, TextInstance>
    | FiberRoot<Container, Instance, TextInstance>
    | null;
  return: Fiber<Container, Instance, TextInstance> | null;
  child: Fiber<Container, Instance, TextInstance> | null;
  sibling: Fiber<Container, Instance, TextInstance> | null;
  index: number;
  alternate: Fiber<Container, Instance, TextInstance> | null;
  flags: Flag;
  deletions: Fiber<Container, Instance, TextInstance>[] | null;
  lanes: Lanes;
  childLanes: Lanes;
  effects: Effect[] | null;
}

interface FiberRoot<Container, Instance, TextInstance> extends LaneRoot {
  container: Container;
  current: Fiber<Container, Instance, TextInstance>;
  element: FigNode;
  callback: ScheduledTask | null;
  callbackPriority: Lane;
  wip: Fiber<Container, Instance, TextInstance> | null;
  finishedWork: Fiber<Container, Instance, TextInstance> | null;
  renderLanes: Lanes;
  pendingReactiveEffects: Effect[];
  reactiveCallback: ScheduledTask | null;
}

export function createRenderer<Container, Instance, TextInstance>(
  host: HostConfig<Container, Instance, TextInstance>,
) {
  type F = Fiber<Container, Instance, TextInstance>;
  type R = FiberRoot<Container, Instance, TextInstance>;
  const roots = new WeakMap<object, R>();
  const scheduledRoots = new Set<R>();
  const batchedRoots = new Set<R>();
  let batchDepth = 0;
  let renderingFiber: F | null = null;
  let currentHook: Hook | null = null;
  let workInProgressHook: Hook | null = null;

  const dispatcher: HookDispatcher = {
    useState(initialState) {
      const hook = updateStateHook(initialState);
      return [hook.memoizedState, hook.queue.dispatch];
    },
    useReactive(effect, deps) {
      updateEffectHook("reactive", ReactiveEffect, effect, deps);
    },
    useBeforePaint(effect, deps) {
      updateEffectHook("before-paint", BeforePaintEffect, effect, deps);
    },
    useBeforeLayout(effect, deps) {
      updateEffectHook("before-layout", BeforeLayoutEffect, effect, deps);
    },
    useOnMount(effect) {
      updateEffectHook("on-mount", ReactiveEffect, effect, []);
    },
  };

  function createRoot(container: Container): FigRoot {
    const key = container as object;
    let root = roots.get(key);

    if (root === undefined) {
      const current = fiber(RootTag, null, null, { children: null }, null);
      root = {
        container,
        current,
        element: null,
        pendingLanes: NoLanes,
        suspendedLanes: NoLanes,
        pingedLanes: NoLanes,
        expiredLanes: NoLanes,
        entangledLanes: NoLanes,
        entanglements: createLaneMap(NoLanes),
        expirationTimes: createLaneMap(NoTimestamp),
        callback: null,
        callbackPriority: NoLane,
        wip: null,
        finishedWork: null,
        renderLanes: NoLanes,
        pendingReactiveEffects: [],
        reactiveCallback: null,
      };
      current.stateNode = root;
      roots.set(key, root);
      scheduledRoots.add(root);
    }

    return {
      render: (children) => updateRoot(root, children),
      unmount: () => updateRoot(root, null),
    };
  }

  function render(children: FigNode, container: Container): FigRoot {
    const root = createRoot(container);
    root.render(children);
    return root;
  }

  function flushSync(callback: () => void): void {
    runWithPriority(SyncLane, callback);

    for (const root of scheduledRoots) {
      if (root.pendingLanes !== NoLanes) {
        root.callback?.cancel();
        root.callback = null;
        root.callbackPriority = NoLane;
        performRoot(root, true);
      }
    }
  }

  function batchedUpdates<T>(callback: () => T): T {
    batchDepth += 1;

    try {
      return callback();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0) {
        for (const root of batchedRoots) scheduleRoot(root);
        batchedRoots.clear();
      }
    }
  }

  function updateRoot(root: R, children: FigNode): void {
    const lane = requestUpdateLane();
    root.element = children;
    markRootUpdated(root, lane);
    scheduleOrBatchRoot(root);
  }

  function scheduleOrBatchRoot(root: R): void {
    if (batchDepth > 0) batchedRoots.add(root);
    else scheduleRoot(root);
  }

  function scheduleRoot(root: R): void {
    markStarvedLanesAsExpired(root, now());

    const nextLanes = getNextLanes(root, root.renderLanes);
    if (nextLanes === NoLanes) return;

    const priorityLane = getHighestPriorityLane(nextLanes);
    if (root.callback !== null && root.callbackPriority === priorityLane)
      return;

    root.callback?.cancel();
    root.callbackPriority = priorityLane;
    root.callback = scheduleCallback(
      getLaneSchedulerPriority(priorityLane),
      () => {
        performRoot(root, isSyncLane(priorityLane));
      },
    );
  }

  function performRoot(root: R, forceSync: boolean): void {
    try {
      performRootWork(root, forceSync);
    } catch (error) {
      abandonRootWork(root);
      throw error;
    }
  }

  function performRootWork(root: R, forceSync: boolean): void {
    if (root.pendingLanes === NoLanes && root.wip === null) return;

    flushPendingReactiveEffects(root);

    if (root.wip === null) {
      root.renderLanes = getNextLanes(root);
      root.finishedWork = createWorkInProgress(root.current, {
        children: root.element,
      });
      root.wip = root.finishedWork;
    }

    while (
      root.wip !== null &&
      (forceSync ||
        isSyncLane(getHighestPriorityLane(root.renderLanes)) ||
        !shouldYieldToHost())
    ) {
      root.wip = performUnit(root.wip);
    }

    if (root.wip !== null) {
      root.callback = null;
      root.callbackPriority = NoLane;
      scheduleRoot(root);
      return;
    }

    if (root.finishedWork !== null) commitRoot(root, root.finishedWork);

    root.renderLanes = NoLanes;
    root.finishedWork = null;
    root.callback = null;
    root.callbackPriority = NoLane;

    if (root.pendingLanes !== NoLanes) scheduleRoot(root);
  }

  function abandonRootWork(root: R): void {
    root.wip = null;
    root.finishedWork = null;
    root.renderLanes = NoLanes;
    root.callback = null;
    root.callbackPriority = NoLane;
  }

  function performUnit(node: F): F | null {
    begin(node);
    if (node.child !== null) return node.child;

    let next: F | null = node;
    while (next !== null) {
      complete(next);
      if (next.sibling !== null) return next.sibling;
      next = next.return;
    }
    return null;
  }

  function begin(node: F): void {
    if (canBailout(node)) {
      cloneChildFibers(node);
      return;
    }

    node.lanes &= ~rootOf(node).renderLanes;

    if (node.tag === FunctionTag) {
      renderFunction(node);
      return;
    }

    if (node.tag === TextTag) {
      node.stateNode ??= host.createTextInstance(String(node.props.nodeValue));
      return;
    }

    if (node.tag === HostTag) {
      node.stateNode ??= host.createInstance(String(node.type), node.props);
    }

    reconcile(node, node.props.children);
  }

  function canBailout(node: F): boolean {
    return (
      node.alternate !== null &&
      (node.flags & PlacementFlag) === 0 &&
      node.props === node.alternate.memoizedProps &&
      !includesSomeLane(node.lanes | node.childLanes, rootOf(node).renderLanes)
    );
  }

  function renderFunction(node: F): void {
    renderingFiber = node;
    currentHook = node.alternate?.memoizedState ?? null;
    workInProgressHook = null;
    node.memoizedState = null;

    const previousDispatcher = setCurrentDispatcher(dispatcher);
    try {
      reconcile(node, (node.type as Component)(node.props));
      if (currentHook !== null) throw hookOrderError("fewer");
    } finally {
      setCurrentDispatcher(previousDispatcher);
      renderingFiber = null;
      currentHook = null;
      workInProgressHook = null;
    }
  }

  function updateStateHook<S>(initialState: S | (() => S)): Hook<S> {
    if (renderingFiber === null) {
      throw new Error(
        "useState can only be called while rendering a component.",
      );
    }

    const oldHook = updateHook("state") as Hook<S> | null;
    const hook: Hook<S> =
      oldHook === null
        ? createHook("state", resolveInitialState(initialState))
        : { ...oldHook, next: null };

    appendHook(hook);

    const queue = hook.queue;
    const pending = queue.pending;
    if (pending !== null) {
      queue.pending = null;
      hook.baseQueue = mergeQueues(hook.baseQueue, pending);
    }

    if (hook.baseQueue !== null) {
      processHookQueue(hook, rootOf(renderingFiber).renderLanes);
    }

    if (queue.dispatch === null) {
      const fiber = renderingFiber;
      queue.dispatch = (action: SetStateAction<S>) => {
        const lane = requestUpdateLane();
        const update: HookUpdate<S> = { action, lane, next: null as never };
        update.next = update;
        queue.pending = mergeQueues(queue.pending, update);
        scheduleFiber(fiber, lane);
      };
    }

    return hook;
  }

  function processHookQueue<S>(hook: Hook<S>, renderLanes: Lanes): void {
    const baseQueue = hook.baseQueue;
    if (baseQueue === null) return;

    let state = hook.baseState;
    let newBaseState = state;
    let newBaseQueue: HookUpdate<S> | null = null;
    let update = baseQueue.next;

    do {
      if (
        update.lane !== NoLane &&
        !includesSomeLane(renderLanes, update.lane)
      ) {
        const cloneUpdate = cloneUpdateNode(update);
        newBaseQueue = mergeQueues(newBaseQueue, cloneUpdate);
        if (newBaseQueue === cloneUpdate) newBaseState = state;
      } else {
        state =
          typeof update.action === "function"
            ? (update.action as (previousState: S) => S)(state)
            : update.action;

        if (newBaseQueue !== null) {
          const cloneUpdate = cloneUpdateNode(update);
          cloneUpdate.lane = NoLane;
          newBaseQueue = mergeQueues(newBaseQueue, cloneUpdate);
        }
      }
      update = update.next;
    } while (update !== baseQueue.next);

    hook.memoizedState = state;
    hook.baseState = newBaseQueue === null ? state : newBaseState;
    hook.baseQueue = newBaseQueue;
  }

  function appendHook(hook: Hook): void {
    if (renderingFiber === null) return;

    if (workInProgressHook === null) {
      renderingFiber.memoizedState = hook;
    } else {
      workInProgressHook.next = hook;
    }

    workInProgressHook = hook;
  }

  function updateEffectHook(
    kind: HookKind,
    phase: EffectPhase,
    create: EffectCallback,
    deps?: DependencyList,
  ): void {
    if (renderingFiber === null) {
      throw new Error("Hooks can only be called while rendering a component.");
    }

    const oldHook = updateHook(kind) as Hook<Effect> | null;
    const nextDeps = deps ?? null;
    const previousEffect = oldHook?.memoizedState ?? null;
    const hasChanged =
      previousEffect === null ||
      !areHookInputsEqual(nextDeps, previousEffect.deps);
    const effect: Effect = {
      tag: EffectTag,
      phase,
      create,
      controller: previousEffect?.controller ?? null,
      deps: nextDeps,
    };
    const hook = createHook(kind, effect);

    appendHook(hook);

    if (hasChanged) {
      renderingFiber.effects ??= [];
      renderingFiber.effects.push(effect);
    }
  }

  function updateHook(kind: HookKind): Hook | null {
    const hook = currentHook;

    if (hook === null) {
      if (didRenderBefore(renderingFiber)) throw hookOrderError("more");
      return null;
    }

    if (hook.kind !== kind) {
      throw new Error(
        `Hook order changed: expected ${hook.kind}, received ${kind}.`,
      );
    }

    currentHook = hook.next;
    return hook;
  }

  function didRenderBefore(node: F | null): boolean {
    const previous = node?.alternate ?? null;
    return previous !== null && previous.memoizedProps !== null;
  }

  function hookOrderError(direction: "fewer" | "more"): Error {
    return new Error(
      `Rendered ${direction} hooks than during the previous render.`,
    );
  }

  function complete(node: F): void {
    let child = node.child;
    let childLanes = NoLanes;

    while (child !== null) {
      childLanes = mergeLanes(childLanes, child.lanes);
      childLanes = mergeLanes(childLanes, child.childLanes);
      child = child.sibling;
    }

    node.childLanes = childLanes;
    node.memoizedProps = node.props;
  }

  function reconcile(parent: F, children: FigNode): void {
    const existing = new Map<string | number, F>();
    for (
      let old = parent.alternate?.child ?? null;
      old !== null;
      old = old.sibling
    ) {
      existing.set(old.key ?? old.index, old);
    }

    parent.child = null;
    parent.deletions = null;

    let previous: F | null = null;
    let lastPlacedIndex = 0;

    normalized(children).forEach((child, index) => {
      const key = isValidElement(child) ? (child.key ?? index) : index;
      const old = existing.get(key);
      const canReuse = old !== undefined && sameType(old, child);
      const next = canReuse
        ? createWorkInProgress(old, propsFor(child))
        : fiberFrom(child);

      if (next === null) return;

      next.index = index;
      next.return = parent;

      if (canReuse) {
        existing.delete(key);
        if (old.index < lastPlacedIndex) next.flags |= PlacementFlag;
        else {
          next.flags |= UpdateFlag;
          lastPlacedIndex = old.index;
        }
      } else {
        next.flags |= PlacementFlag;
      }

      previous = appendChild(parent, previous, next);
    });

    for (const child of existing.values()) {
      parent.deletions ??= [];
      parent.deletions.push(child);
    }
  }

  function commitRoot(root: R, finishedWork: F): void {
    commitEffects(finishedWork.child, BeforeLayoutEffect);
    commitDeletions(finishedWork);
    commitMutationEffects(finishedWork.child);
    root.current = finishedWork;
    markRootFinished(root, root.pendingLanes & ~root.renderLanes);
    commitEffects(finishedWork.child, BeforePaintEffect);
    collectReactiveEffects(root, finishedWork.child);
    clearEffectLists(finishedWork.child);
    scheduleReactiveEffects(root);
  }

  function commitMutationEffects(node: F | null): void {
    if (node === null) return;

    if ((node.flags & PlacementFlag) !== 0) {
      commitPlacement(node);
    } else if ((node.flags & UpdateFlag) !== 0 && isHost(node)) {
      commitUpdate(node);
    }

    commitMutationEffects(node.child);
    commitMutationEffects(node.sibling);
  }

  function commitPlacement(node: F): void {
    if (isHost(node)) {
      commitUpdate(node);
      host.insertBefore(hostParent(node), hostNode(node), hostSibling(node));
    } else if (node.alternate !== null) {
      insertHostSubtree(node, hostParent(node), hostSibling(node));
    }
  }

  function insertHostSubtree(
    node: F,
    parent: Parent<Container, Instance>,
    before: HostNode<Instance, TextInstance> | null,
  ): void {
    visitHostNodes(node, (child) => host.insertBefore(parent, child, before));
  }

  function commitUpdate(node: F): void {
    if (node.tag === TextTag) {
      host.commitTextUpdate(
        node.stateNode as TextInstance,
        String(node.props.nodeValue),
      );
    } else {
      host.commitUpdate(
        node.stateNode as Instance,
        node.alternate?.memoizedProps ?? {},
        node.props,
      );
    }
  }

  function commitDeletions(node: F): void {
    if (node.deletions !== null) {
      const parent =
        node.tag === RootTag
          ? (node.stateNode as R).container
          : node.tag === HostTag
            ? (node.stateNode as Instance)
            : hostParent(node);
      for (const child of node.deletions) {
        abortFiberEffects(child);
        remove(child, parent);
      }
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      commitDeletions(child);
    }
  }

  function remove(node: F, parent: Parent<Container, Instance>): void {
    visitHostNodes(node, (child) => host.removeChild(parent, child));
  }

  function visitHostNodes(
    node: F,
    visitor: (node: HostNode<Instance, TextInstance>) => void,
  ): void {
    if (isHost(node)) {
      visitor(hostNode(node));
      return;
    }
    for (let child = node.child; child !== null; child = child.sibling) {
      visitHostNodes(child, visitor);
    }
  }

  function hostParent(node: F): Parent<Container, Instance> {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (parent.tag === RootTag) return (parent.stateNode as R).container;
      if (parent.tag === HostTag) return parent.stateNode as Instance;
    }

    throw new Error("Could not find a host parent for fiber.");
  }

  function hostSibling(node: F): HostNode<Instance, TextInstance> | null {
    let cursor: F = node;

    search: while (true) {
      while (cursor.sibling === null) {
        if (
          cursor.return === null ||
          cursor.return.tag === RootTag ||
          cursor.return.tag === HostTag
        ) {
          return null;
        }
        cursor = cursor.return;
      }

      cursor = cursor.sibling;

      while (!isHost(cursor)) {
        if ((cursor.flags & PlacementFlag) !== 0 || cursor.child === null) {
          continue search;
        }
        cursor = cursor.child;
      }

      if ((cursor.flags & PlacementFlag) === 0) return hostNode(cursor);
    }
  }

  function scheduleFiber(node: F, lane: Lane): void {
    markLanes(node, lane);

    for (let parent = node.return; parent !== null; parent = parent.return) {
      markChildLanes(parent, lane);

      if (parent.tag === RootTag) {
        const root = parent.stateNode as R;
        markRootUpdated(root, lane);
        scheduleOrBatchRoot(root);
        return;
      }
    }
  }

  function markLanes(node: F, lane: Lane): void {
    node.lanes = mergeLanes(node.lanes, lane);
    if (node.alternate !== null) {
      node.alternate.lanes = mergeLanes(node.alternate.lanes, lane);
    }
  }

  function markChildLanes(node: F, lane: Lane): void {
    node.childLanes = mergeLanes(node.childLanes, lane);
    if (node.alternate !== null) {
      node.alternate.childLanes = mergeLanes(node.alternate.childLanes, lane);
    }
  }

  function createWorkInProgress(current: F, props: Props): F {
    const next =
      current.alternate ??
      fiber(current.tag, current.type, current.key, props, current.stateNode);

    next.props = props;
    next.memoizedProps = current.memoizedProps;
    next.memoizedState = current.memoizedState;
    next.stateNode = current.stateNode;
    next.return = current.return;
    next.child = null;
    next.sibling = null;
    next.index = current.index;
    next.flags = NoFlags;
    next.deletions = null;
    next.lanes = current.lanes;
    next.childLanes = current.childLanes;
    next.effects = null;
    next.alternate = current;
    current.alternate = next;

    return next;
  }

  function cloneChildFibers(parent: F): void {
    let current = parent.alternate?.child ?? null;
    let previous: F | null = null;
    parent.child = null;

    while (current !== null) {
      const next = createWorkInProgress(current, current.props);
      next.index = current.index;
      next.return = parent;

      previous = appendChild(parent, previous, next);
      current = current.sibling;
    }
  }

  function appendChild(parent: F, previous: F | null, child: F): F {
    if (previous === null) parent.child = child;
    else previous.sibling = child;
    return child;
  }

  function fiberFrom(child: FigChild): F | null {
    if (typeof child === "string" || typeof child === "number") {
      return fiber(TextTag, null, null, { nodeValue: String(child) }, null);
    }

    if (!isValidElement(child)) return null;

    return fiber(tagFor(child), child.type, child.key, child.props, null);
  }

  function fiber(
    tag: Tag,
    type: ElementType | null,
    key: string | number | null,
    props: Props,
    stateNode: F["stateNode"],
  ): F {
    return {
      tag,
      type,
      key,
      props,
      memoizedProps: null,
      memoizedState: null,
      stateNode,
      return: null,
      child: null,
      sibling: null,
      index: 0,
      alternate: null,
      flags: NoFlags,
      deletions: null,
      lanes: NoLanes,
      childLanes: NoLanes,
      effects: null,
    };
  }

  function rootOf(node: F): R {
    for (let parent: F | null = node; parent !== null; parent = parent.return) {
      if (parent.tag === RootTag) return parent.stateNode as R;
    }

    throw new Error("Could not find a root for fiber.");
  }

  return { batchedUpdates, createRoot, render, flushSync };

  function commitEffects(node: F | null, phase: EffectPhase): void {
    visitEffects(node, (effect) => {
      if (effect.phase === phase) runEffect(effect);
    });
  }

  function collectReactiveEffects(root: R, node: F | null): void {
    visitEffects(node, (effect) => {
      if (effect.phase === ReactiveEffect)
        root.pendingReactiveEffects.push(effect);
    });
  }

  function scheduleReactiveEffects(root: R): void {
    if (
      root.pendingReactiveEffects.length === 0 ||
      root.reactiveCallback !== null
    ) {
      return;
    }

    root.reactiveCallback = scheduleCallback(NormalPriority, () => {
      flushReactiveEffects(root);
    });
  }

  function flushPendingReactiveEffects(root: R): void {
    root.reactiveCallback?.cancel();
    flushReactiveEffects(root);
  }

  function flushReactiveEffects(root: R): void {
    root.reactiveCallback = null;

    const effects = root.pendingReactiveEffects;
    root.pendingReactiveEffects = [];

    for (const effect of effects) runEffect(effect);
  }

  function visitEffects(
    node: F | null,
    visitor: (effect: Effect) => void,
  ): void {
    if (node === null) return;

    for (const effect of node.effects ?? []) visitor(effect);

    visitEffects(node.child, visitor);
    visitEffects(node.sibling, visitor);
  }

  function runEffect(effect: Effect): void {
    abortEffect(effect);
    effect.controller = new AbortController();
    effect.create(effect.controller.signal);
  }

  function abortFiberEffects(node: F): void {
    for (let hook = node.memoizedState; hook !== null; hook = hook.next) {
      const value = hook.memoizedState;
      if (isEffect(value)) {
        abortEffect(value);
      }
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      abortFiberEffects(child);
    }
  }

  function abortEffect(effect: Effect): void {
    effect.controller?.abort();
    effect.controller = null;
  }

  function clearEffectLists(node: F | null): void {
    if (node === null) return;

    node.effects = null;
    clearEffectLists(node.child);
    clearEffectLists(node.sibling);
  }
}

function createHook<S>(kind: HookKind, state: S): Hook<S> {
  return {
    kind,
    memoizedState: state,
    baseState: state,
    baseQueue: null,
    queue: { pending: null, dispatch: null },
    next: null,
  };
}

function resolveInitialState<S>(initialState: S | (() => S)): S {
  return typeof initialState === "function"
    ? (initialState as () => S)()
    : initialState;
}

function mergeQueues<S>(
  baseQueue: HookUpdate<S> | null,
  pendingQueue: HookUpdate<S>,
): HookUpdate<S> {
  if (baseQueue === null) return pendingQueue;

  const baseFirst = baseQueue.next;
  const pendingFirst = pendingQueue.next;
  baseQueue.next = pendingFirst;
  pendingQueue.next = baseFirst;
  return pendingQueue;
}

function cloneUpdateNode<S>(update: HookUpdate<S>): HookUpdate<S> {
  const clone: HookUpdate<S> = {
    action: update.action,
    lane: update.lane,
    next: null as never,
  };
  clone.next = clone;
  return clone;
}

function tagFor(element: FigElement): Tag {
  if (typeof element.type === "string") return HostTag;
  if (element.type === Fragment) return FragmentTag;
  return FunctionTag;
}

function sameType<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
  child: FigChild,
): boolean {
  if (typeof child === "string" || typeof child === "number") {
    return fiber.tag === TextTag;
  }

  return isValidElement(child) && fiber.type === child.type;
}

function propsFor(child: FigChild): Props {
  return typeof child === "string" || typeof child === "number"
    ? { nodeValue: String(child) }
    : child.props;
}

function normalized(node: FigNode): FigChild[] {
  if (Array.isArray(node)) return node.flatMap(normalized);
  return node === null || node === undefined || typeof node === "boolean"
    ? []
    : [node];
}

function isHost<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
): boolean {
  return fiber.tag === HostTag || fiber.tag === TextTag;
}

function hostNode<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
): HostNode<Instance, TextInstance> {
  return fiber.stateNode as HostNode<Instance, TextInstance>;
}

function areHookInputsEqual(
  nextDeps: DependencyList | null,
  previousDeps: DependencyList | null,
): boolean {
  if (nextDeps === null || previousDeps === null) return false;
  if (nextDeps.length !== previousDeps.length) return false;

  for (let index = 0; index < nextDeps.length; index += 1) {
    if (!Object.is(nextDeps[index], previousDeps[index])) return false;
  }

  return true;
}

function isEffect(value: unknown): value is Effect {
  return typeof value === "object" && value !== null && "tag" in value
    ? value.tag === EffectTag
    : false;
}

export { DefaultLane, runWithPriority, SyncLane };
