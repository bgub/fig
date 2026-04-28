import {
  type DependencyList,
  type Dispatch,
  type EffectCallback,
  type ElementType,
  type FigChild,
  type FigContext,
  type FigElement,
  type FigNode,
  Fragment,
  isContext,
  isValidElement,
  type Props,
  type RenderDispatcher,
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
  markRootPinged,
  markRootSuspended,
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
import { isThenable, readThenable, type Thenable } from "./thenables.ts";

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
const ContextProviderTag = 5;
type Tag =
  | typeof RootTag
  | typeof HostTag
  | typeof TextTag
  | typeof FunctionTag
  | typeof FragmentTag
  | typeof ContextProviderTag;

const NoFlags = 0;
const PlacementFlag = 1 << 0;
const UpdateFlag = 1 << 1;
type Flag = number;

const ReactiveEffect = 0;
const BeforePaintEffect = 1;
const BeforeLayoutEffect = 2;
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
  contextDependencies: FigContext<unknown>[] | null;
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
  suspendedThenables: WeakMap<object, Lanes>;
  consumedPendingQueues: ConsumedPendingQueue[];
}

interface ConsumedPendingQueue {
  queue: HookQueue<unknown>;
  pending: HookUpdate<unknown>;
}

export function createRenderer<Container, Instance, TextInstance>(
  host: HostConfig<Container, Instance, TextInstance>,
) {
  type F = Fiber<Container, Instance, TextInstance>;
  type R = FiberRoot<Container, Instance, TextInstance>;
  const roots = new WeakMap<object, R>();
  const pendingRoots = new Set<R>();
  const batchedRoots = new Set<R>();
  let batchDepth = 0;
  let renderingFiber: F | null = null;
  let currentHook: Hook | null = null;
  let workInProgressHook: Hook | null = null;

  const dispatcher: RenderDispatcher = {
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
    readContext(context) {
      return readContextValue(context);
    },
    readPromise(promise) {
      return readThenable(promise);
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
        suspendedThenables: new WeakMap(),
        consumedPendingQueues: [],
      };
      current.stateNode = root;
      roots.set(key, root);
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

    for (const root of pendingRoots) {
      if (root.pendingLanes !== NoLanes) {
        root.callback?.cancel();
        root.callback = null;
        root.callbackPriority = NoLane;
        performRoot(root, true);
      } else {
        pendingRoots.delete(root);
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
    markRootPending(root, lane);
    scheduleOrBatchRoot(root);
  }

  function markRootPending(root: R, lane: Lane): void {
    markRootUpdated(root, lane);
    pendingRoots.add(root);
  }

  function scheduleOrBatchRoot(root: R): void {
    if (batchDepth > 0) batchedRoots.add(root);
    else scheduleRoot(root);
  }

  function scheduleRoot(root: R): void {
    markStarvedLanesAsExpired(root, now());

    const nextLanes = getNextLanes(root, root.renderLanes);
    if (nextLanes === NoLanes) {
      if (root.pendingLanes === NoLanes) pendingRoots.delete(root);
      return;
    }

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
      const suspendedLanes = root.renderLanes;
      abandonRootWork(root);

      if (isThenable(error)) {
        markRootSuspended(root, suspendedLanes);
        attachPing(root, error, suspendedLanes);
        return;
      }

      throw error;
    }
  }

  function performRootWork(root: R, forceSync: boolean): void {
    if (root.pendingLanes === NoLanes && root.wip === null) {
      pendingRoots.delete(root);
      return;
    }

    flushPendingReactiveEffects(root);

    const nextLanes = getNextLanes(root, root.renderLanes);
    if (
      root.wip !== null &&
      nextLanes !== NoLanes &&
      nextLanes !== root.renderLanes
    ) {
      restartRootWork(root);
    }

    if (root.wip === null) {
      root.renderLanes = nextLanes;
      root.consumedPendingQueues = [];
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

    finishRootWork(root);
  }

  function finishRootWork(root: R): void {
    root.renderLanes = NoLanes;
    root.finishedWork = null;
    root.callback = null;
    root.callbackPriority = NoLane;

    if (root.pendingLanes !== NoLanes) scheduleRoot(root);
    else pendingRoots.delete(root);
  }

  function abandonRootWork(root: R): void {
    restartRootWork(root);
    root.callback = null;
    root.callbackPriority = NoLane;
  }

  function restartRootWork(root: R): void {
    restoreConsumedPendingQueues(root);
    root.wip = null;
    root.finishedWork = null;
    root.renderLanes = NoLanes;
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

    if (changedContextProvider(node)) propagateContextChange(node);

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
    node.contextDependencies = null;

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

    const root = rootOf(renderingFiber);
    const queue = hook.queue;
    const pending = queue.pending;
    if (pending !== null) {
      hook.baseQueue = consumePendingHookQueue(root, hook, queue, pending);
    }

    if (hook.baseQueue !== null) {
      processHookQueue(hook, root.renderLanes);
    }

    if (queue.dispatch === null) {
      const fiber = renderingFiber;
      queue.dispatch = (action: SetStateAction<S>) => {
        if (renderingFiber !== null) {
          throw new Error(
            "State updates are not allowed while rendering a component.",
          );
        }

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

  function consumePendingHookQueue<S>(
    root: R,
    hook: Hook<S>,
    queue: HookQueue<S>,
    pending: HookUpdate<S>,
  ): HookUpdate<S> | null {
    queue.pending = null;
    root.consumedPendingQueues.push({
      queue: queue as HookQueue<unknown>,
      pending: pending as HookUpdate<unknown>,
    });
    return mergeQueues(cloneQueue(hook.baseQueue), cloneQueueNodes(pending));
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

  function readContextValue<T>(context: FigContext<T>): T {
    if (renderingFiber === null) {
      throw new Error(
        "readContext can only be called while rendering a component.",
      );
    }

    addContextDependency(renderingFiber, context);

    for (
      let parent = renderingFiber.return;
      parent !== null;
      parent = parent.return
    ) {
      if (parent.tag === ContextProviderTag && parent.type === context) {
        return parent.props.value as T;
      }
    }

    return context.defaultValue;
  }

  function addContextDependency(node: F, context: FigContext<unknown>): void {
    node.contextDependencies ??= [];

    if (!node.contextDependencies.includes(context)) {
      node.contextDependencies.push(context);
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
    const existing = new Map<string, F>();
    const seenKeys = new Set<string>();
    for (
      let old = parent.alternate?.child ?? null;
      old !== null;
      old = old.sibling
    ) {
      existing.set(fiberChildKey(old), old);
    }

    parent.child = null;
    parent.deletions = null;

    let previous: F | null = null;
    let lastPlacedIndex = 0;

    forEachChild(children, (child, index) => {
      const key = childKey(child, index, seenKeys);
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
    root.consumedPendingQueues = [];
    markRootFinished(root, root.pendingLanes & ~root.renderLanes);
    commitEffects(finishedWork.child, BeforePaintEffect);
    collectReactiveEffects(root, finishedWork.child);
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
        markRootPending(root, lane);
        scheduleOrBatchRoot(root);
        return;
      }
    }
  }

  function attachPing(root: R, thenable: Thenable, lanes: Lanes): void {
    if (lanes === NoLanes) return;

    const previousLanes = root.suspendedThenables.get(thenable) ?? NoLanes;
    root.suspendedThenables.set(thenable, mergeLanes(previousLanes, lanes));

    if (previousLanes !== NoLanes) return;
    thenable.then(
      () => ping(root, thenable),
      () => ping(root, thenable),
    );
  }

  function ping(root: R, thenable: object): void {
    const lanes = root.suspendedThenables.get(thenable) ?? NoLanes;
    if (lanes === NoLanes) return;

    root.suspendedThenables.delete(thenable);
    markRootPinged(root, lanes);
    pendingRoots.add(root);
    scheduleRoot(root);
  }

  function propagateContextChange(provider: F): void {
    const currentProvider = provider.alternate;
    if (currentProvider === null) return;

    const context = provider.type as FigContext<unknown>;
    const lanes = rootOf(provider).renderLanes;

    for (
      let child = currentProvider.child;
      child !== null;
      child = child.sibling
    ) {
      markContextConsumers(child, currentProvider, context, lanes);
    }
  }

  function markContextConsumers(
    node: F,
    provider: F,
    context: FigContext<unknown>,
    lanes: Lanes,
  ): void {
    if (node.tag === ContextProviderTag && node.type === context) return;

    if (node.contextDependencies?.includes(context) === true) {
      markLanes(node, lanes);
      markParentPath(node, provider, lanes);
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      markContextConsumers(child, provider, context, lanes);
    }
  }

  function markParentPath(node: F, stopAt: F, lanes: Lanes): void {
    for (
      let parent = node.return;
      parent !== null && parent !== stopAt;
      parent = parent.return
    ) {
      markChildLanes(parent, lanes);
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
    next.contextDependencies = current.contextDependencies;
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
      contextDependencies: null,
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
    if (node === null) return;

    for (const effect of node.effects ?? []) {
      if (effect.phase === ReactiveEffect)
        root.pendingReactiveEffects.push(effect);
    }

    node.effects = null;
    collectReactiveEffects(root, node.child);
    collectReactiveEffects(root, node.sibling);
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
      if (isEffectHook(hook.kind)) abortEffect(hook.memoizedState as Effect);
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      abortFiberEffects(child);
    }
  }

  function abortEffect(effect: Effect): void {
    effect.controller?.abort();
    effect.controller = null;
  }

  function restoreConsumedPendingQueues(root: R): void {
    for (const { queue, pending } of root.consumedPendingQueues) {
      queue.pending =
        queue.pending === null ? pending : mergeQueues(pending, queue.pending);
    }

    root.consumedPendingQueues = [];
  }
}

function isEffectHook(kind: HookKind): boolean {
  return (
    kind === "reactive" ||
    kind === "on-mount" ||
    kind === "before-paint" ||
    kind === "before-layout"
  );
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

function cloneQueue<S>(queue: HookUpdate<S> | null): HookUpdate<S> | null {
  if (queue === null) return null;
  return cloneQueueNodes(queue);
}

function cloneQueueNodes<S>(queue: HookUpdate<S>): HookUpdate<S> {
  let clone: HookUpdate<S> | null = null;
  let update = queue.next;

  do {
    clone = mergeQueues(clone, cloneUpdateNode(update));
    update = update.next;
  } while (update !== queue.next);

  return clone as HookUpdate<S>;
}

function tagFor(element: FigElement): Tag {
  if (typeof element.type === "string") return HostTag;
  if (element.type === Fragment) return FragmentTag;
  if (isContext(element.type)) return ContextProviderTag;
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

function childKey(
  child: FigChild,
  index: number,
  seenKeys: Set<string>,
): string {
  if (!isValidElement(child) || child.key === null) return implicitKey(index);

  const key = explicitKey(child.key);
  if (seenKeys.has(key)) throw duplicateKeyError(child.key);
  seenKeys.add(key);
  return key;
}

function fiberChildKey<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
): string {
  return fiber.key === null ? implicitKey(fiber.index) : explicitKey(fiber.key);
}

function explicitKey(key: string | number): string {
  return `$${String(key)}`;
}

function implicitKey(index: number): string {
  return `.${index}`;
}

function forEachChild(
  node: FigNode,
  visitor: (child: FigChild, index: number) => void,
  index = 0,
): number {
  if (Array.isArray(node)) {
    let nextIndex = index;
    for (const child of node) {
      nextIndex = forEachChild(child as FigNode, visitor, nextIndex);
    }
    return nextIndex;
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return index;
  }

  if (
    typeof node === "string" ||
    typeof node === "number" ||
    isValidElement(node)
  ) {
    visitor(node, index);
    return index + 1;
  }

  throw invalidChildError(node);
}

function duplicateKeyError(key: string | number): Error {
  return new Error(`Duplicate key "${String(key)}" found among siblings.`);
}

function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child: ${describeInvalidChild(value)}. Render a string, number, element, array, boolean, null, or undefined.`,
  );
}

function describeInvalidChild(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;

  const keys = Object.keys(value);
  return keys.length === 0 ? "object" : `object with keys ${keys.join(", ")}`;
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

function changedContextProvider<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
): boolean {
  return (
    fiber.tag === ContextProviderTag &&
    fiber.alternate !== null &&
    !Object.is(fiber.props.value, fiber.alternate.memoizedProps?.value)
  );
}

export { DefaultLane, runWithPriority, SyncLane };
