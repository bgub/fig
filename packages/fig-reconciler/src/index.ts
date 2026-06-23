import {
  type ActionStateAction,
  type ActionStateDispatch,
  type DependencyList,
  type Dispatch,
  type EffectCallback,
  type ElementType,
  type ErrorInfo,
  type ExternalStoreSubscribe,
  type FigChild,
  type FigContext,
  type FigElement,
  type FigNode,
  type FigPortal,
  Fragment,
  type Props,
  type ReactiveEventArgs,
  type SetStateAction,
  type StartTransition,
} from "@bgub/fig";
import {
  dataResourceKeysForError,
  isActivity,
  isContext,
  isErrorBoundary,
  isPortal,
  isResources,
  isSuspense,
  isValidElement,
  setCurrentDispatcher,
  setCurrentDataStore,
  setTransitionHandler,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
  type DataResourceKeyInput,
  type RenderDispatcher,
} from "@bgub/fig/internal";
import { createDataStore, type DataStore } from "@bgub/fig-data";
import {
  NormalPriority,
  now,
  type ScheduledTask,
  scheduleCallback,
  shouldYieldToHost,
} from "@bgub/fig-scheduler";
import {
  devtoolsTypeName,
  type FigDevtoolsCommitInspection,
  type FigDevtoolsEffectPhase,
  type FigDevtoolsFiberKind,
  type FigDevtoolsFiberSnapshot,
  type FigDevtoolsHostSnapshot,
  type FigDevtoolsHookKind,
  type FigDevtoolsHookSnapshot,
  type FigDevtoolsRootSnapshot,
  getFigDevtoolsGlobalHook,
} from "./devtools.ts";
import {
  claimNextRetryLane,
  claimNextTransitionLane,
  createLaneMap,
  DefaultHydrationLane,
  DefaultLane,
  DeferredLane,
  getHighestPriorityLane,
  getLaneSchedulerPriority,
  getNextLanes,
  includesOnlyTransitions,
  includesSomeLane,
  isSyncLane,
  type Lane,
  type LaneRoot,
  type Lanes,
  markRootFinished,
  markRootEntangled,
  markRootPinged,
  markRootSuspended,
  markRootUpdated,
  markStarvedLanesAsExpired,
  mergeLanes,
  NoLane,
  NoLanes,
  NoTimestamp,
  OffscreenLane,
  requestUpdateLane,
  RetryLanes,
  runWithPriority,
  runWithTransition,
  runWithTransitionLane,
  SelectiveHydrationLane,
  SyncLane,
} from "./lanes.ts";
import { isThenable, readThenable, type Thenable } from "./thenables.ts";

export * from "./devtools.ts";
export {
  DefaultLane,
  DeferredLane,
  GestureLane,
  IdleLane,
  InputContinuousLane,
  type Lane,
  type LanePriority,
  type Lanes,
  OffscreenLane,
  requestUpdateLane,
  runWithPriority,
  runWithTransition,
  SyncLane,
  TransitionLane,
} from "./lanes.ts";

declare const process: { env: { NODE_ENV?: string } };

setTransitionHandler(runWithTransition);

type Component = (props: Props & { children?: FigNode }) => FigNode;
type HostNode<Instance, TextInstance> = Instance | TextInstance;
type Parent<Container, Instance> = Container | Instance;

export interface DehydratedSuspenseError {
  digest?: string;
  message?: string;
}

export interface DehydratedSuspenseBoundary<
  Instance = unknown,
  TextInstance = unknown,
> {
  error?: DehydratedSuspenseError | null;
  id: string | null;
  start: HostNode<Instance, TextInstance>;
  end: HostNode<Instance, TextInstance>;
  status: "completed" | "pending" | "client-rendered";
  forceClientRender: boolean;
}

export interface HostConfig<Container, Instance, TextInstance> {
  createInstance(
    type: string,
    props: Props,
    parent: Parent<Container, Instance>,
  ): Instance;
  createTextInstance(text: string): TextInstance;
  appendInitialChild?(
    parent: Instance,
    child: HostNode<Instance, TextInstance>,
  ): void;
  finalizeInitialInstance?(instance: Instance, props: Props): void;
  setTextContent?(instance: Instance, text: string): void;
  getFirstHydratableChild?(
    parent: Parent<Container, Instance>,
    props?: Props,
  ): HostNode<Instance, TextInstance> | null;
  getNextHydratableSibling?(
    node: HostNode<Instance, TextInstance>,
  ): HostNode<Instance, TextInstance> | null;
  canHydrateInstance?(
    node: HostNode<Instance, TextInstance>,
    type: string,
    props: Props,
  ): boolean;
  canHydrateTextInstance?(
    node: HostNode<Instance, TextInstance>,
    text: string,
  ): boolean;
  shouldCommitUpdate?(
    type: string,
    previousProps: Props,
    nextProps: Props,
  ): boolean;
  clearContainer?(container: Container): void;
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
  commitHydratedInstance?(instance: Instance, nextProps: Props): void;
  getActivityBoundary?(node: HostNode<Instance, TextInstance>): Instance | null;
  getFirstActivityHydratable?(
    boundary: Instance,
  ): HostNode<Instance, TextInstance> | null;
  commitHydratedActivityBoundary?(boundary: Instance): void;
  hideInstance?(instance: Instance): void;
  unhideInstance?(instance: Instance, props: Props): void;
  hideTextInstance?(instance: TextInstance): void;
  unhideTextInstance?(instance: TextInstance, text: string): void;
  getSuspenseBoundary?(
    node: HostNode<Instance, TextInstance>,
  ): DehydratedSuspenseBoundary<Instance, TextInstance> | null;
  isTargetWithinSuspenseBoundary?(
    target: unknown,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): boolean;
  registerSuspenseBoundaryRetry?(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
    retry: () => void,
  ): void;
  commitHydratedSuspenseBoundary?(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void;
  removeDehydratedSuspenseBoundary?(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void;
  preparePortalContainer?(
    container: Parent<Container, Instance>,
    root: Container,
    logicalParent: Parent<Container, Instance>,
  ): void;
  removePortalContainer?(container: Parent<Container, Instance>): void;
  commitTextUpdate(text: TextInstance, value: string): void;
}

export interface FigRoot {
  data: FigDataStoreHandle;
  render(children: FigNode): void;
  unmount(): void;
}

export interface FigRootOptions {
  dataContext?: unknown;
  dataPartition?: DataResourceKeyInput;
  initialData?: readonly FigDataHydrationEntry[];
  identifierPrefix?: string;
  devtools?: boolean;
  onRecoverableError?: (error: unknown, info: RecoverableErrorInfo) => void;
  onUncaughtError?: (error: unknown, info: ErrorInfo) => void;
}

export interface RecoverableErrorInfo extends ErrorInfo {
  actual?: string;
  boundaryId?: string;
  digest?: string;
  expected?: string;
  recovery: "root" | "suspense";
  source: "hydration" | "server";
}

export type HydrationTargetResult = "none" | "hydrated" | "blocked";

type HydrationHostConfig<Container, Instance, TextInstance> = Required<
  Pick<
    HostConfig<Container, Instance, TextInstance>,
    | "getFirstHydratableChild"
    | "getNextHydratableSibling"
    | "canHydrateInstance"
    | "canHydrateTextInstance"
    | "clearContainer"
  >
>;

const RootTag = 0;
const HostTag = 1;
const TextTag = 2;
const FunctionTag = 3;
const FragmentTag = 4;
const ContextProviderTag = 5;
const SuspenseTag = 6;
const ErrorBoundaryTag = 7;
const PortalTag = 8;
const ResourcesTag = 9;
const ActivityTag = 10;
type Tag =
  | typeof RootTag
  | typeof HostTag
  | typeof TextTag
  | typeof FunctionTag
  | typeof FragmentTag
  | typeof ContextProviderTag
  | typeof SuspenseTag
  | typeof ErrorBoundaryTag
  | typeof PortalTag
  | typeof ResourcesTag
  | typeof ActivityTag;

const NoFlags = 0;
const PlacementFlag = 1 << 0;
const UpdateFlag = 1 << 1;
const HydrationFlag = 1 << 2;
const TextContentFlag = 1 << 3;
// The fiber reused its committed children without cloning; render skips the
// subtree and commit walks must not re-read its already-committed state.
const AdoptedFlag = 1 << 4;
// An Activity boundary whose visibility changes this commit (or mounts
// hidden); the mutation phase applies host hiding and effect deferral.
const VisibilityFlag = 1 << 5;
// A host fiber that assembled its children at complete-time (appendInitialChild
// path), so commit inserts the whole subtree once instead of placing children
// individually. Recorded at complete-time because commit mutates the underlying
// signal (committedProps) before the placement walk reads it.
const AssembledFlag = 1 << 6;
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

interface Hook<S = any> {
  kind: FigDevtoolsHookKind;
  memoizedState: S;
  baseState: S;
  baseQueue: HookUpdate<S> | null;
  queue: HookQueue<S>;
  next: Hook<any> | null;
}

interface Effect {
  phase: EffectPhase;
  create: EffectCallback;
  controller: AbortController | null;
  deps: DependencyList | null;
  owner: Fiber<unknown, unknown, unknown>;
  // Carried across renders like controller; gates the dev-only strict
  // re-run to once per hook lifetime so renders nested inside an effect
  // (e.g. flushSync) cannot re-trigger the cycle.
  strictRan: boolean;
}

type ReactiveEventHandler = (...args: unknown[]) => unknown;

interface ReactiveEventInstance {
  controller: AbortController | null;
  handler: ReactiveEventHandler | null;
  live: boolean;
  stable: ReactiveEventHandler;
}

interface ReactiveEventState {
  instance: ReactiveEventInstance;
  // Lives on the per-render hook state, not the persistent instance: commits
  // republish bailed-out fibers' hooks, so an abandoned render's handler must
  // never be reachable from the instance.
  next: ReactiveEventHandler;
}

interface MemoState<T> {
  value: T;
  deps: DependencyList;
}

interface TransitionState {
  pendingCount: number;
  start: StartTransition | null;
}

const NoActionStateError = Symbol();

interface ActionStateInstance<S, Args extends unknown[]> {
  action: ActionStateAction<S, Args>;
  value: S;
}

interface ActionState<S, Args extends unknown[]> {
  error: unknown;
  instance: ActionStateInstance<S, Args>;
  pending: number;
  action: ActionStateAction<S, Args>;
  value: S;
}

type QueuedHookKind = "state" | "transition" | "action-state";

interface ExternalStoreInstance<T, Owner> {
  committedSubscribe: ExternalStoreSubscribe | null;
  getSnapshot: () => T;
  owner: Owner | null;
  unsubscribe: (() => void) | null;
  value: T;
}

interface ExternalStoreState<T, Owner> {
  getSnapshot: () => T;
  instance: ExternalStoreInstance<T, Owner>;
  subscribe: ExternalStoreSubscribe;
  value: T;
}

interface SuspenseFallbackState<Container, Instance, TextInstance> {
  kind: "fallback";
  primaryChild: Fiber<Container, Instance, TextInstance> | null;
}

interface DehydratedSuspenseState<Instance, TextInstance> {
  kind: "dehydrated";
  boundary: DehydratedSuspenseBoundary<Instance, TextInstance>;
}

type SuspenseState<Container, Instance, TextInstance> =
  | SuspenseFallbackState<Container, Instance, TextInstance>
  | DehydratedSuspenseState<Instance, TextInstance>;

interface ErrorBoundaryState {
  error: unknown;
  info: ErrorInfo;
  didReport: boolean;
}

type SuspensePings<Container, Instance, TextInstance> = WeakMap<
  Fiber<Container, Instance, TextInstance>,
  Lanes
>;

interface Fiber<Container, Instance, TextInstance> {
  tag: Tag;
  type: ElementType | null;
  key: string | number | null;
  props: Props;
  memoizedProps: Props | null;
  committedProps: Props | null;
  memoizedState: Hook<any> | null;
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
  dataDependenciesDirty: boolean;
  suspenseState: SuspenseState<Container, Instance, TextInstance> | null;
  errorBoundaryState: ErrorBoundaryState | null;
  // Shared by both fiber generations and updated at commit, so visibility
  // checks from stale .return chains stay authoritative.
  activityState: ActivityState<Instance> | null;
}

interface ActivityState<Instance> {
  hidden: boolean;
  // The host boundary (an inert template holding server content) while the
  // boundary is dehydrated, or null; cleared when the content unpacks at
  // commit.
  dehydrated: Instance | null;
}

interface FiberRoot<Container, Instance, TextInstance> extends LaneRoot {
  container: Container;
  current: Fiber<Container, Instance, TextInstance>;
  element: FigNode;
  identifierPrefix: string;
  devtools: boolean;
  callback: ScheduledTask | null;
  callbackPriority: Lane;
  wip: Fiber<Container, Instance, TextInstance> | null;
  finishedWork: Fiber<Container, Instance, TextInstance> | null;
  renderLanes: Lanes;
  dataStore: DataStore<Fiber<Container, Instance, TextInstance>, Lane>;
  pendingReactiveEffects: Effect[];
  reactiveCallback: ScheduledTask | null;
  suspendedThenables: WeakMap<object, Lanes>;
  suspendedBoundaries: WeakMap<
    object,
    SuspensePings<Container, Instance, TextInstance>
  >;
  consumedPendingQueues: ConsumedPendingQueue[];
  onRecoverableError: (error: unknown, info: RecoverableErrorInfo) => void;
  onUncaughtError: ((error: unknown, info: ErrorInfo) => void) | null;
  recoverableErrors: RecoverableErrorRecord[];
  uncaughtErrorInfo: ErrorInfo | null;
  isHydrating: boolean;
  hydrationParent: Fiber<Container, Instance, TextInstance> | null;
  hydratingSuspenseBoundary: Fiber<Container, Instance, TextInstance> | null;
  hydratingActivityBoundary: Fiber<Container, Instance, TextInstance> | null;
  nextHydratableInstance: HostNode<Instance, TextInstance> | null;
  clearContainerBeforeCommit: boolean;
  hydrationInitialElement: FigNode | typeof NoHydrationInitialElement;
}

interface ConsumedPendingQueue {
  queue: HookQueue<unknown>;
  pending: HookUpdate<unknown>;
}

interface RecoverableErrorRecord {
  error: unknown;
  info: RecoverableErrorInfo;
}

interface HydrationMismatch {
  actual?: string;
  boundaryId?: string;
  expected?: string;
  message: string;
}

type RecoverableDetails = Omit<RecoverableErrorInfo, "componentStack">;

const PreservedSuspense = Symbol("fig.preserved-suspense");
const NoHydrationInitialElement = Symbol("fig.no-hydration-initial-element");

class HydrationMismatchError extends Error {}

export function createRenderer<Container, Instance, TextInstance>(
  host: HostConfig<Container, Instance, TextInstance>,
) {
  type F = Fiber<Container, Instance, TextInstance>;
  type R = FiberRoot<Container, Instance, TextInstance>;
  type ActivityHydrationHostConfig = HostConfig<
    Container,
    Instance,
    TextInstance
  > &
    Required<
      Pick<
        HostConfig<Container, Instance, TextInstance>,
        | "getActivityBoundary"
        | "getFirstActivityHydratable"
        | "commitHydratedActivityBoundary"
      >
    >;
  const roots = new WeakMap<object, R>();
  // Iterable view of live roots, only populated when a refresh handler is set,
  // so a hot-reload pass can walk every mounted tree (dev-only; empty in prod).
  const mountedRoots = new Set<R>();
  const pendingRoots = new Set<R>();
  const batchedRoots = new Set<R>();
  const abandonedHydrationBoundaries = new WeakSet<object>();
  let batchDepth = 0;
  let flushingSyncWork = false;
  let hasHiddenActivities = false;
  let activityHostConfig: ReturnType<typeof requireActivityHostConfig> | null =
    null;
  let activityHydrationHostConfig: ActivityHydrationHostConfig | null = null;
  let renderingFiber: F | null = null;
  let currentHook: Hook | null = null;
  let workInProgressHook: Hook | null = null;
  let localIdCounter = 0;

  const dispatcher: RenderDispatcher = {
    useState(initialState) {
      const hook = updateStateHook(initialState);
      const dispatch = hook.queue.dispatch;
      if (dispatch === null) {
        throw new Error("Expected state dispatch to be initialized.");
      }

      return [hook.memoizedState, dispatch];
    },
    useActionState(action, initialState) {
      return updateActionStateHook(action, initialState);
    },
    useId() {
      return updateIdHook();
    },
    useLaggedValue(value, initialValue, hasInitialValue) {
      return updateLaggedValueHook(value, initialValue, hasInitialValue);
    },
    useMemo(calculate, deps) {
      return updateMemoHook(calculate, deps);
    },
    useTransition() {
      return updateTransitionHook();
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
    useExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      return updateExternalStoreHook(subscribe, getSnapshot, getServerSnapshot);
    },
    useReactiveEvent(handler) {
      return updateReactiveEventHook(handler);
    },
    readContext(context) {
      return readContextValue(context);
    },
    readData(resource, args) {
      const fiber = requireRenderingFiber();
      return rootOf(fiber).dataStore.readData(resource, args, fiber);
    },
    preloadData(resource, args) {
      const fiber = requireRenderingFiber();
      rootOf(fiber).dataStore.preloadData(resource, args);
    },
    readPromise(promise) {
      return readThenable(promise);
    },
  };

  function createRoot(
    container: Container,
    options: FigRootOptions = {},
  ): FigRoot {
    return rootHandle(rootForContainer(container, { kind: "client", options }));
  }

  function hydrateRoot(
    container: Container,
    children: FigNode,
    options: FigRootOptions = {},
  ): FigRoot {
    const root = rootForContainer(container, { kind: "hydration", options });
    root.hydrationInitialElement = children;
    updateRoot(root, children);
    return rootHandle(root);
  }

  function rootForContainer(
    container: Container,
    request: {
      kind: "client" | "hydration";
      options?: FigRootOptions;
      reuse?: boolean;
    },
  ): R {
    const existing = roots.get(container as object);
    if (existing !== undefined) {
      if (request.reuse === true) return existing;
      throw duplicateRootError(request.kind);
    }

    if (request.kind === "hydration") requireHydrationHostConfig();

    const root = createFiberRoot(container, request.options ?? {});
    roots.set(container as object, root);
    if (resolveFamily !== null) mountedRoots.add(root);

    if (request.kind === "hydration") root.isHydrating = true;

    return root;
  }

  function createFiberRoot(container: Container, options: FigRootOptions): R {
    const current = fiber(RootTag, null, null, { children: null }, null);
    const dataStore = createDataStore<F, Lane>({
      context: options.dataContext ?? {},
      getLane: requestUpdateLane,
      partition: options.dataPartition,
      schedule(owner, lane) {
        scheduleFiber(owner, hiddenActivityLane(owner, lane));
      },
    });
    const root: R = {
      container,
      current,
      element: null,
      identifierPrefix: options.identifierPrefix ?? "",
      devtools: options.devtools ?? true,
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
      dataStore,
      pendingReactiveEffects: [],
      reactiveCallback: null,
      suspendedThenables: new WeakMap(),
      suspendedBoundaries: new WeakMap(),
      consumedPendingQueues: [],
      onRecoverableError: options.onRecoverableError ?? noop,
      onUncaughtError: options.onUncaughtError ?? null,
      recoverableErrors: [],
      uncaughtErrorInfo: null,
      isHydrating: false,
      hydrationParent: null,
      hydratingSuspenseBoundary: null,
      hydratingActivityBoundary: null,
      nextHydratableInstance: null,
      clearContainerBeforeCommit: false,
      hydrationInitialElement: NoHydrationInitialElement,
    };
    if (options.initialData !== undefined)
      dataStore.hydrate(options.initialData);
    current.stateNode = root;
    return root;
  }

  function duplicateRootError(kind: "client" | "hydration"): Error {
    const method = kind === "hydration" ? "hydrateRoot" : "createRoot";
    return new Error(
      `Cannot call ${method} on a container that already has a Fig root. Use the existing root.render(...) to update it instead.`,
    );
  }

  function noop(): void {}

  function rootHandle(root: R): FigRoot {
    return {
      data: root.dataStore,
      render: (children) => updateRoot(root, children),
      unmount: () => {
        // Tear the tree down synchronously so per-fiber data cleanup runs while
        // the store is still live; dispose is then the final teardown step.
        flushSync(() => updateRoot(root, null));
        root.dataStore.dispose();
        // Free the container so a later createRoot/render starts a fresh root
        // instead of reusing this one's now-disposed store.
        roots.delete(root.container as object);
        mountedRoots.delete(root);
      },
    };
  }

  function render(children: FigNode, container: Container): FigRoot {
    const root = rootHandle(
      rootForContainer(container, { kind: "client", reuse: true }),
    );
    root.render(children);
    return root;
  }

  function hydrateTarget(
    container: Container,
    target: unknown,
    lane: Lane = SelectiveHydrationLane,
  ): HydrationTargetResult {
    const root = roots.get(container as object);
    if (root === undefined || host.isTargetWithinSuspenseBoundary === undefined)
      return "none";

    const boundary = findDehydratedSuspenseBoundaryForTarget(
      root.current.child,
      target,
    );
    if (boundary === null) return "none";

    scheduleFiber(boundary, lane);
    if (isSyncLane(lane)) performRoot(root, true);
    return findDehydratedSuspenseBoundaryForTarget(
      root.current.child,
      target,
    ) === null
      ? "hydrated"
      : "blocked";
  }

  function flushSync(callback: () => void): void {
    runWithPriority(SyncLane, callback);

    // Save/restore rather than force false: a nested flushSync (e.g. unmount()
    // from a commit-phase effect) must not clear the flag while an outer flush is
    // still running, or the outer flush's uncaught errors get misrouted.
    const previousFlushingSyncWork = flushingSyncWork;
    flushingSyncWork = true;
    try {
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
    } finally {
      flushingSyncWork = previousFlushingSyncWork;
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
    if (shouldClientRenderEarlyHydrationUpdate(root, children)) {
      forceClientRender(root);
    }

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
      if (error === PreservedSuspense) {
        restartRootWork(root);
        return;
      }

      if (error instanceof HydrationMismatchError) {
        recoverFromHydrationMismatch(root);
        return;
      }

      if (isThenable(error)) {
        const suspendedLanes = root.renderLanes;
        restartRootWork(root);
        markRootSuspended(root, suspendedLanes);
        attachPing(root, error, suspendedLanes);
        return;
      }

      const info = root.uncaughtErrorInfo ?? errorInfoFor(root.current, error);
      restartRootWork(root);
      clearRootAfterUncaughtError(root);
      reportUncaughtError(root, error, info);

      // flushSync callers observe the error directly. Outside flushSync the
      // error must not escape into the scheduler tick (that would stall other
      // queued tasks), so without an onUncaughtError handler it is rethrown
      // from a detached task to surface as a global error.
      if (flushingSyncWork) throw error;
      if (root.onUncaughtError === null) {
        setTimeout(() => {
          throw error;
        });
      }
    }
  }

  function recoverFromHydrationMismatch(root: R): void {
    if (root.hydratingSuspenseBoundary !== null) {
      recoverFromSuspenseHydrationMismatch(
        root,
        root.hydratingSuspenseBoundary,
      );
      return;
    }

    markHydrationRecovery(root, "root");
    restartRootWork(root);
    forceClientRender(root);
    performRoot(root, true);
  }

  function recoverFromSuspenseHydrationMismatch(root: R, boundary: F): void {
    const current = boundary.alternate ?? boundary;
    const state = current.suspenseState;

    restartRootWork(root);

    if (state?.kind !== "dehydrated") {
      markHydrationRecovery(root, "root");
      forceClientRender(root);
      performRoot(root, true);
      return;
    }

    markHydrationRecovery(root, "suspense");
    state.boundary.forceClientRender = true;
    deactivateHydration(root);
    scheduleFiber(current, SelectiveHydrationLane);
    performRoot(root, true);
  }

  function markHydrationRecovery(
    root: R,
    recovery: RecoverableErrorInfo["recovery"],
  ): void {
    for (const record of root.recoverableErrors) {
      if (record.info.source === "hydration") record.info.recovery = recovery;
    }
  }

  function shouldClientRenderEarlyHydrationUpdate(
    root: R,
    children: FigNode,
  ): boolean {
    return (
      root.isHydrating &&
      root.current.child === null &&
      root.hydrationInitialElement !== NoHydrationInitialElement &&
      root.hydrationInitialElement !== children
    );
  }

  function forceClientRender(root: R): void {
    deactivateHydration(root);
    root.clearContainerBeforeCommit = true;
    root.hydrationInitialElement = NoHydrationInitialElement;
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
      prepareToHydrateRoot(root);
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
    resetRootWork(root);

    if (root.pendingLanes !== NoLanes) scheduleRoot(root);
    else pendingRoots.delete(root);
  }

  function restartRootWork(root: R): void {
    restoreConsumedPendingQueues(root);
    resetRootWork(root);
  }

  function resetRootWork(root: R): void {
    root.wip = null;
    root.finishedWork = null;
    root.renderLanes = NoLanes;
    root.callback = null;
    root.callbackPriority = NoLane;
    resetHydrationPointers(root);
    root.uncaughtErrorInfo = null;
  }

  function resetHydrationPointers(root: R): void {
    root.hydrationParent = null;
    root.hydratingSuspenseBoundary = null;
    root.hydratingActivityBoundary = null;
    root.nextHydratableInstance = null;
  }

  function deactivateHydration(root: R): void {
    root.isHydrating = false;
    resetHydrationPointers(root);
  }

  function performUnit(node: F): F | null {
    try {
      begin(node);
    } catch (error) {
      return handleThrownValue(node, error);
    }

    if ((node.flags & AdoptedFlag) === 0 && node.child !== null) {
      return node.child;
    }

    return completeUnit(node);
  }

  function handleThrownValue(node: F, error: unknown): F | null {
    const root = rootOf(node);
    if (root.hydratingActivityBoundary !== null) abandonActivityHydration(root);

    if (isThenable(error)) {
      const boundary = findSuspenseBoundary(node);
      if (boundary !== null) return captureSuspenseBoundary(boundary, error);

      throw error;
    }

    if (error instanceof HydrationMismatchError) throw error;

    const boundary = findErrorBoundary(node);
    if (boundary !== null) return captureErrorBoundary(boundary, error, node);

    rootOf(node).uncaughtErrorInfo = errorInfoFor(node, error);
    throw error;
  }

  function completeUnit(node: F): F | null {
    let next: F | null = node;
    while (next !== null) {
      complete(next);
      if (next.sibling !== null) return next.sibling;
      next = next.return;
    }
    return null;
  }

  function begin(node: F): void {
    const root = rootOf(node);

    if (canBailout(node, root)) {
      if (!includesSomeLane(node.childLanes, root.renderLanes)) {
        // The whole subtree is clean: adopt the committed children without
        // cloning and skip them entirely.
        node.flags |= AdoptedFlag;
        node.child = node.alternate?.child ?? null;
        return;
      }

      // Descendants have work but this fiber does not: clone children and
      // descend without re-rendering, preserving child props identity.
      // Suspense always runs begin so hidden-primary retries are handled.
      if (node.tag !== SuspenseTag) {
        cloneChildFibers(node);
        return;
      }
    }

    const hasOwnWork = includesSomeLane(node.lanes, root.renderLanes);
    node.lanes &= ~root.renderLanes;

    if (node.tag === FunctionTag) {
      renderFunction(node);
      return;
    }

    if (node.tag === TextTag) {
      if (tryHydrateText(node)) return;
      node.stateNode ??= host.createTextInstance(String(node.props.nodeValue));
      return;
    }

    if (node.tag === HostTag) {
      const children = hostChildren(node.props);

      if (tryHydrateInstance(node)) {
        reconcileCurrentChildren(node, children);
        return;
      }

      node.stateNode ??= host.createInstance(
        String(node.type),
        node.props,
        hostParent(node),
      );

      reconcileCurrentChildren(
        node,
        children === null || shouldUseHostTextContent(node) ? null : children,
      );
      return;
    }

    if (node.tag === SuspenseTag) {
      beginSuspense(node, hasOwnWork);
      return;
    }

    if (node.tag === ErrorBoundaryTag) {
      beginErrorBoundary(node);
      return;
    }

    if (node.tag === ActivityTag) {
      beginActivity(root, node);
      return;
    }

    if (node.tag === PortalTag) {
      beginPortal(node);
      return;
    }

    if (changedContextProvider(node)) propagateContextChange(node);

    reconcileCurrentChildren(node, node.props.children);
  }

  function beginActivity(root: R, node: F): void {
    const hidden = activityHidden(node.props);
    if (hidden) hasHiddenActivities = true;
    const previousHidden =
      node.alternate === null
        ? false
        : activityHidden(node.alternate.memoizedProps ?? {});

    node.activityState ??= { hidden: false, dehydrated: null };
    const state = node.activityState;

    if (
      state.dehydrated === null &&
      tryDehydrateActivityBoundary(root, node, state)
    ) {
      // Server-hidden content stays dehydrated; if the client wants it
      // visible, a follow-up render hydrates through.
      if (!hidden) scheduleFiber(node, DefaultLane);
      return;
    }

    if (state.dehydrated !== null) {
      if (hidden) return;
      hydrateDehydratedActivityBoundary(root, node);
      return;
    }

    if (hidden !== previousHidden) {
      node.flags |= VisibilityFlag;
    }

    // A reveal with pending offscreen work expands the render lanes so the
    // revealed subtree commits already up to date. Offscreen work skipped by
    // earlier bailouts is re-marked pending after commit.
    if (!hidden && previousHidden) {
      if (
        includesSomeLane(node.childLanes, OffscreenLane) &&
        !includesSomeLane(root.renderLanes, OffscreenLane)
      ) {
        root.renderLanes = mergeLanes(root.renderLanes, OffscreenLane);
      }
    }

    reconcileCurrentChildren(node, node.props.children);
  }

  function prepareToHydrateRoot(root: R): void {
    if (!root.isHydrating) return;

    const hydrationHost = requireHydrationHostConfig();
    root.hydrationParent = root.finishedWork;
    root.nextHydratableInstance = hydrationHost.getFirstHydratableChild(
      root.container,
    );
  }

  function tryHydrateInstance(node: F): boolean {
    const root = rootOf(node);
    if (!shouldHydrateFiber(root, node)) return false;

    const hydrationHost = requireHydrationHostConfig();
    const hydratable = root.nextHydratableInstance;
    const type = String(node.type);

    if (hydratable === null) {
      throwHydrationMismatch(root, node, {
        actual: "nothing",
        expected: `<${type}>`,
        message: `expected <${type}>, but found no DOM node`,
      });
    }

    if (!hydrationHost.canHydrateInstance(hydratable, type, node.props)) {
      throwHydrationMismatch(root, node, {
        actual: "different DOM node",
        expected: `<${type}>`,
        message: `expected <${type}>`,
      });
    }

    node.stateNode = hydratable as Instance;
    node.flags |= UpdateFlag | HydrationFlag;
    root.hydrationParent = node;
    root.nextHydratableInstance = hydrationHost.getFirstHydratableChild(
      hydratable as Instance,
      node.props,
    );

    return true;
  }

  function tryHydrateText(node: F): boolean {
    const root = rootOf(node);
    if (!shouldHydrateFiber(root, node)) return false;

    const hydrationHost = requireHydrationHostConfig();
    const hydratable = root.nextHydratableInstance;
    const text = String(node.props.nodeValue);

    if (hydratable === null) {
      throwHydrationMismatch(root, node, {
        actual: "nothing",
        expected: "text",
        message: "expected text, but found no DOM node",
      });
    }

    if (!hydrationHost.canHydrateTextInstance(hydratable, text)) {
      throwHydrationMismatch(root, node, {
        actual: "different DOM node",
        expected: "text",
        message: "expected text",
      });
    }

    node.stateNode = hydratable as TextInstance;
    node.flags |= UpdateFlag;
    root.nextHydratableInstance =
      hydrationHost.getNextHydratableSibling(hydratable);

    return true;
  }

  function shouldHydrateFiber(root: R, node: F): boolean {
    return (
      root.isHydrating && node.alternate === null && node.stateNode === null
    );
  }

  function completeHydration(node: F): void {
    const root = rootOf(node);

    if (
      node.tag === SuspenseTag &&
      (node.flags & HydrationFlag) !== 0 &&
      root.hydratingSuspenseBoundary === node
    ) {
      completeDehydratedSuspenseHydration(root, node);
      return;
    }

    if (
      node.tag === ActivityTag &&
      (node.flags & HydrationFlag) !== 0 &&
      root.hydratingActivityBoundary === node
    ) {
      if (root.nextHydratableInstance !== null) {
        throwHydrationMismatch(root, node, {
          actual: "extra DOM node",
          message: "found an extra DOM node in Activity",
        });
      }
      leaveActivityHydration(root, node);
      return;
    }

    if (!root.isHydrating || root.hydrationParent !== node) return;

    if (root.nextHydratableInstance !== null) {
      throwHydrationMismatch(root, node, {
        actual: "extra DOM node",
        message: "found an extra DOM node",
      });
    }

    const hydrationHost = requireHydrationHostConfig();
    root.hydrationParent = nextHydrationParent(node.return);
    root.nextHydratableInstance =
      node.tag === HostTag
        ? hydrationHost.getNextHydratableSibling(node.stateNode as Instance)
        : null;
  }

  function completeDehydratedSuspenseHydration(root: R, node: F): void {
    const boundary = dehydratedSuspenseBoundary(node.alternate);

    if (boundary === null) return;

    if (
      boundary.status === "completed" &&
      !boundary.forceClientRender &&
      root.nextHydratableInstance !== boundary.end
    ) {
      throwHydrationMismatch(root, node, {
        actual: "extra DOM node",
        boundaryId: boundary.id ?? undefined,
        message: "found an extra DOM node in Suspense",
      });
    }

    leaveSuspenseHydration(root, node, boundary);
  }

  function nextHydrationParent(node: F | null): F | null {
    for (let parent = node; parent !== null; parent = parent.return) {
      if (
        parent.tag === RootTag ||
        parent.tag === HostTag ||
        (parent.tag === SuspenseTag &&
          (parent.flags & HydrationFlag) !== 0 &&
          dehydratedSuspenseBoundary(parent.alternate) !== null) ||
        (parent.tag === ActivityTag &&
          (parent.flags & HydrationFlag) !== 0 &&
          parent.activityState?.dehydrated != null)
      ) {
        return parent;
      }
    }

    return null;
  }

  function firstWithinSuspenseBoundary(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): HostNode<Instance, TextInstance> | null {
    const first = requireHydrationHostConfig().getNextHydratableSibling(
      boundary.start,
    );
    return first === boundary.end ? null : first;
  }

  function nextAfterSuspenseBoundary(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): HostNode<Instance, TextInstance> | null {
    return requireHydrationHostConfig().getNextHydratableSibling(boundary.end);
  }

  function requireHydrationHostConfig(): HydrationHostConfig<
    Container,
    Instance,
    TextInstance
  > {
    if (
      host.getFirstHydratableChild === undefined ||
      host.getNextHydratableSibling === undefined ||
      host.canHydrateInstance === undefined ||
      host.canHydrateTextInstance === undefined ||
      host.clearContainer === undefined
    ) {
      throw new Error("Hydration is not supported by this renderer.");
    }

    return host as HydrationHostConfig<Container, Instance, TextInstance>;
  }

  function throwHydrationMismatch(
    root: R,
    node: F,
    mismatch: HydrationMismatch,
  ): never {
    const error = new Error(`Hydration mismatch: ${mismatch.message}.`);
    queueRecoverableError(root, node, error, {
      actual: mismatch.actual,
      boundaryId: mismatch.boundaryId,
      expected: mismatch.expected,
      recovery: "root",
      source: "hydration",
    });
    throw new HydrationMismatchError(error.message);
  }

  function canBailout(node: F, root: R): boolean {
    return (
      node.alternate !== null &&
      (node.flags & PlacementFlag) === 0 &&
      node.props === node.alternate.memoizedProps &&
      !includesSomeLane(node.lanes, root.renderLanes)
    );
  }

  function shouldUseHostTextContent(node: F): boolean {
    return (
      host.setTextContent !== undefined &&
      !rootOf(node).isHydrating &&
      hostTextContent(node.props.children) !== null
    );
  }

  function renderFunction(node: F): void {
    // Hot reload: run the latest version of this component's family. In
    // production no handler is set, so this is a no-op.
    if (resolveFamily !== null) {
      node.type = resolveLatestType(node.type) as F["type"];
    }
    prepareHookRender(node);

    const previousDispatcher = setCurrentDispatcher(dispatcher);
    const previousDataStore = setCurrentDataStore(rootOf(node).dataStore);
    try {
      if (process.env.NODE_ENV !== "production") {
        // Strict shadow pass: invoke the component once and discard every
        // trace so impure renders surface in development. Skipping
        // reconciliation keeps the pass free of child and deletion effects.
        const root = rootOf(node);
        const consumedBefore = root.consumedPendingQueues.length;
        (node.type as Component)(node.props);
        if (currentHook !== null) throw hookOrderError("fewer");
        restoreConsumedPendingQueues(root, consumedBefore);
        prepareHookRender(node);
        node.effects = null;
      }
      reconcileCurrentChildren(node, (node.type as Component)(node.props));
      if (currentHook !== null) throw hookOrderError("fewer");
    } finally {
      setCurrentDataStore(previousDataStore);
      setCurrentDispatcher(previousDispatcher);
      renderingFiber = null;
      currentHook = null;
      workInProgressHook = null;
      localIdCounter = 0;
    }
  }

  function prepareHookRender(node: F): void {
    renderingFiber = node;
    currentHook = node.alternate?.memoizedState ?? null;
    workInProgressHook = null;
    localIdCounter = 0;
    node.memoizedState = null;
    node.contextDependencies = null;
    rootOf(node).dataStore.resetDataDependencies(node);
    node.dataDependenciesDirty = true;
  }

  function beginSuspense(node: F, hasOwnWork: boolean): void {
    const previousSuspenseState = node.alternate?.suspenseState ?? null;

    node.suspenseState = null;

    if (previousSuspenseState?.kind === "dehydrated") {
      if (!hasOwnWork) {
        node.suspenseState = previousSuspenseState;
        return;
      }
      hydrateDehydratedSuspenseBoundary(node, previousSuspenseState.boundary);
      return;
    }

    if (tryDehydrateSuspenseBoundary(node)) return;

    if (previousSuspenseState === null) {
      reconcileCurrentChildren(node, node.props.children);
      return;
    }

    if (previousSuspenseState.kind !== "fallback") {
      reconcileCurrentChildren(node, node.props.children);
      return;
    }

    reconcile(
      node,
      node.props.children,
      previousSuspenseState.primaryChild,
      true,
    );
    appendDeletions(node, node.alternate?.child ?? null);
  }

  function tryDehydrateSuspenseBoundary(node: F): boolean {
    const root = rootOf(node);
    if (!shouldHydrateFiber(root, node)) return false;
    if (host.getSuspenseBoundary === undefined) return false;

    const hydratable = root.nextHydratableInstance;
    if (hydratable === null) return false;

    const boundary = host.getSuspenseBoundary(hydratable);
    if (boundary === null) return false;

    node.suspenseState = { kind: "dehydrated", boundary };
    host.registerSuspenseBoundaryRetry?.(boundary, () =>
      scheduleFiber(node, DefaultLane),
    );
    root.nextHydratableInstance = nextAfterSuspenseBoundary(boundary);
    return true;
  }

  function hydrateDehydratedSuspenseBoundary(
    node: F,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void {
    abandonedHydrationBoundaries.delete(node);
    if (node.alternate !== null) {
      abandonedHydrationBoundaries.delete(node.alternate);
    }

    if (!boundary.forceClientRender) {
      if (boundary.status === "completed") {
        enterSuspenseHydration(node, boundary);
        node.suspenseState = null;
        node.flags |= HydrationFlag;
        reconcile(node, node.props.children, null, false);
        return;
      }

      if (boundary.status === "pending") {
        node.suspenseState = { kind: "dehydrated", boundary };
        return;
      }
    }

    if (boundary.status === "client-rendered") {
      queueClientRenderedSuspenseError(rootOf(node), node, boundary);
    }

    node.suspenseState = null;
    node.flags |= HydrationFlag;
    reconcile(node, node.props.children, null, false);
  }

  function queueClientRenderedSuspenseError(
    root: R,
    node: F,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void {
    const boundaryError = boundary.error;
    const error = new Error(
      boundaryError?.message ??
        "The server could not finish this Suspense boundary. Switched to client rendering.",
    );
    if (boundaryError?.digest !== undefined) {
      (error as Error & { digest?: string }).digest = boundaryError.digest;
    }
    queueRecoverableError(root, node, error, {
      boundaryId: boundary.id ?? undefined,
      digest: boundaryError?.digest,
      recovery: "suspense",
      source: "server",
    });
  }

  function requireActivityHydrationHostConfig(): ActivityHydrationHostConfig {
    if (activityHydrationHostConfig !== null)
      return activityHydrationHostConfig;

    if (
      host.getActivityBoundary === undefined ||
      host.getFirstActivityHydratable === undefined ||
      host.commitHydratedActivityBoundary === undefined
    ) {
      throw new Error(
        "Activity hydration requires getActivityBoundary, getFirstActivityHydratable, and commitHydratedActivityBoundary.",
      );
    }

    activityHydrationHostConfig = host as ActivityHydrationHostConfig;
    return activityHydrationHostConfig;
  }

  function tryDehydrateActivityBoundary(
    root: R,
    node: F,
    state: ActivityState<Instance>,
  ): boolean {
    if (!shouldHydrateFiber(root, node)) return false;
    if (host.getActivityBoundary === undefined) return false;

    const hydratable = root.nextHydratableInstance;
    if (hydratable === null) return false;

    const boundary = host.getActivityBoundary(hydratable);
    if (boundary === null) return false;

    // A detected boundary commits the host to the full lifecycle; partial
    // configs fail loudly here instead of silently never revealing content.
    requireActivityHydrationHostConfig();

    hasHiddenActivities = true;
    state.dehydrated = boundary;
    root.nextHydratableInstance =
      requireHydrationHostConfig().getNextHydratableSibling(boundary);
    return true;
  }

  function hydrateDehydratedActivityBoundary(root: R, node: F): void {
    enterActivityHydration(root, node);
    node.flags |= HydrationFlag | VisibilityFlag;
    reconcile(node, node.props.children, null, false);
  }

  function enterActivityHydration(root: R, node: F): void {
    const boundary = dehydratedActivityBoundary(node);
    if (boundary === null) {
      throw new Error("Expected a dehydrated Activity boundary.");
    }

    root.isHydrating = true;
    root.hydrationParent = node;
    root.hydratingActivityBoundary = node;
    root.nextHydratableInstance =
      requireActivityHydrationHostConfig().getFirstActivityHydratable(boundary);
  }

  function leaveActivityHydration(root: R, node: F): void {
    root.hydrationParent = nextHydrationParent(node.return);
    root.nextHydratableInstance = null;
    root.hydratingActivityBoundary = null;
    root.isHydrating = false;
  }

  // Any throw while hydrating a dehydrated Activity abandons the attempt:
  // the boundary stays dehydrated and a later render retries cleanly.
  function abandonActivityHydration(root: R): void {
    deactivateHydration(root);
  }

  function enterSuspenseHydration(
    node: F,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void {
    const root = rootOf(node);
    root.isHydrating = true;
    root.hydrationParent = node;
    root.hydratingSuspenseBoundary = node;
    root.nextHydratableInstance = firstWithinSuspenseBoundary(boundary);
  }

  function leaveSuspenseHydration(
    root: R,
    node: F,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void {
    root.hydrationParent = nextHydrationParent(node.return);
    root.nextHydratableInstance = nextAfterSuspenseBoundary(boundary);
    root.hydratingSuspenseBoundary = null;
    root.isHydrating = false;
  }

  function beginErrorBoundary(node: F): void {
    const previousErrorState = node.alternate?.errorBoundaryState ?? null;

    node.errorBoundaryState = previousErrorState;

    reconcileCurrentChildren(
      node,
      previousErrorState === null
        ? node.props.children
        : (node.props.fallback as FigNode),
    );
  }

  function beginPortal(node: F): void {
    reconcileCurrentChildren(node, node.props.children as FigNode);
  }

  function updateStateHook<S>(initialState: S | (() => S)): Hook<S> {
    const hook = updateQueuedHook("state", initialState);
    const queue = hook.queue;
    const fiber = requireRenderingFiber();

    if (queue.dispatch === null) {
      queue.dispatch = (action: SetStateAction<S>) => {
        if (renderingFiber !== null) {
          throw new Error(
            "State updates are not allowed while rendering a component.",
          );
        }

        scheduleHookUpdate(fiber, queue, action, requestUpdateLane());
      };
    }

    return hook;
  }

  function updateActionStateHook<S, Args extends unknown[]>(
    action: ActionStateAction<S, Args>,
    initialState: S,
  ): [S, ActionStateDispatch<Args>, boolean] {
    const hook: Hook<ActionState<S, Args>> = updateQueuedHook(
      "action-state",
      () => createActionState(action, initialState),
    );
    const queue = hook.queue;
    const fiber = requireRenderingFiber();
    const instance = hook.memoizedState.instance;
    const nextState = { ...hook.memoizedState, action };
    hook.memoizedState = nextState;
    if (hook.baseQueue === null) {
      hook.baseState = nextState;
    } else {
      hook.baseState = { ...hook.baseState, action };
    }

    if (queue.dispatch === null) {
      const updatePending = (delta: 1 | -1, lane: Lane) => {
        scheduleHookUpdate(
          fiber,
          queue,
          (state) => ({
            ...state,
            pending: Math.max(0, state.pending + delta),
          }),
          lane,
        );
      };
      const finish = (lane: Lane, error: unknown, ...value: [] | [S]) => {
        scheduleHookUpdate(
          fiber,
          queue,
          (state) => ({
            ...state,
            error,
            pending: Math.max(0, state.pending - 1),
            value: value.length === 0 ? state.value : value[0],
          }),
          lane,
        );
      };

      queue.dispatch = ((...args: Args) => {
        if (renderingFiber !== null) {
          throw new Error(
            "Action state updates are not allowed during render.",
          );
        }

        const lane = claimNextTransitionLane();
        updatePending(1, SyncLane);

        let result: S | PromiseLike<S>;
        try {
          result = rootOf(fiber).dataStore.run(() =>
            runWithTransitionLane(lane, () => {
              return instance.action(instance.value, ...args);
            }),
          );
        } catch (error) {
          finish(lane, error);
          return;
        }

        if (!isThenable(result)) {
          finish(lane, NoActionStateError, result);
          return;
        }

        result.then(
          (value) => {
            finish(lane, NoActionStateError, value);
          },
          (error: unknown) => {
            finish(lane, error);
          },
        );
      }) as unknown as Dispatch<SetStateAction<ActionState<S, Args>>>;
    }

    if (hook.memoizedState.error !== NoActionStateError) {
      throw hook.memoizedState.error;
    }

    return [
      hook.memoizedState.value,
      queue.dispatch as unknown as ActionStateDispatch<Args>,
      hook.memoizedState.pending > 0,
    ];
  }

  function updateIdHook(): string {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook("id") as Hook<string> | null;
    const id =
      oldHook === null
        ? createFiberId(rootOf(fiber), fiber, localIdCounter)
        : oldHook.memoizedState;
    localIdCounter += 1;

    appendHook(createHook("id", id));
    return id;
  }

  function updateMemoHook<T>(calculate: () => T, deps: DependencyList): T {
    requireRenderingFiber();
    const previous = (updateHook("memo") as Hook<MemoState<T>> | null)
      ?.memoizedState;
    const state =
      previous !== undefined && areHookInputsEqual(deps, previous.deps)
        ? previous
        : { deps, value: calculate() };

    appendHook(createHook("memo", state));
    return state.value;
  }

  function updateLaggedValueHook<T>(
    value: T,
    initialValue: T | undefined,
    hasInitialValue: boolean,
  ): T {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook("lagged-value") as Hook<T> | null;
    let next =
      oldHook === null
        ? initialLaggedValue(value, initialValue, hasInitialValue)
        : oldHook.memoizedState;

    if (!Object.is(next, value)) {
      if (isTransitionOrDeferredRender(rootOf(fiber))) {
        next = value;
      } else {
        scheduleFiber(fiber, DeferredLane);
      }
    }

    appendHook(createHook("lagged-value", next));
    return next;
  }

  function initialLaggedValue<T>(
    value: T,
    initialValue: T | undefined,
    hasInitialValue: boolean,
  ): T {
    return hasInitialValue ? (initialValue as T) : value;
  }

  function isTransitionOrDeferredRender(root: R): boolean {
    return (
      includesOnlyTransitions(root.renderLanes) ||
      includesSomeLane(root.renderLanes, DeferredLane)
    );
  }

  function updateTransitionHook(): [boolean, StartTransition] {
    const initialState: TransitionState = {
      pendingCount: 0,
      start: null,
    };
    const hook: Hook<TransitionState> = updateQueuedHook(
      "transition",
      initialState,
    );
    const queue = hook.queue;

    if (hook.memoizedState.start === null) {
      const fiber = requireRenderingFiber();
      const updatePending = (delta: 1 | -1, lane: Lane) => {
        scheduleHookUpdate(
          fiber,
          queue,
          (state) => ({
            ...state,
            pendingCount: Math.max(0, state.pendingCount + delta),
          }),
          lane,
        );
      };

      hook.memoizedState.start = (callback) => {
        if (renderingFiber !== null) {
          throw new Error(
            "Transitions cannot be started while rendering a component.",
          );
        }

        const lane = claimNextTransitionLane();
        const finish = () => updatePending(-1, lane);
        updatePending(1, SyncLane);

        let result: unknown;
        try {
          result = rootOf(fiber).dataStore.run(() =>
            runWithTransitionLane(lane, callback),
          );
        } catch (error) {
          finish();
          throw error;
        }

        if (!isThenable(result)) {
          finish();
          return;
        }

        result.then(finish, (error: unknown) => {
          finish();
          queueMicrotask(() => {
            throw error;
          });
        });
      };
    }

    const start = hook.memoizedState.start;
    if (start === null) {
      throw new Error("Expected transition starter to be initialized.");
    }

    return [hook.memoizedState.pendingCount > 0, start];
  }

  function requireRenderingFiber(): F {
    if (renderingFiber === null) {
      throw new Error("Hooks can only be called while rendering a component.");
    }

    return renderingFiber;
  }

  function updateQueuedHook<S>(
    kind: QueuedHookKind,
    initialState: S | (() => S),
  ): Hook<S> {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook(kind) as Hook<S> | null;
    const hook: Hook<S> =
      oldHook === null
        ? createHook(kind, resolveInitialState(initialState))
        : { ...oldHook, next: null };

    appendHook(hook);

    const root = rootOf(fiber);
    const pending = hook.queue.pending;
    if (pending !== null) {
      hook.baseQueue = consumePendingHookQueue(root, hook, hook.queue, pending);
    }

    if (hook.baseQueue !== null) {
      processHookQueue(hook, root.renderLanes);
    }

    return hook;
  }

  function updateExternalStoreHook<T>(
    subscribe: ExternalStoreSubscribe,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook("external-store") as Hook<
      ExternalStoreState<T, F>
    > | null;
    const root = rootOf(fiber);
    const value = readExternalStoreSnapshot(
      root,
      getSnapshot,
      getServerSnapshot,
    );
    const instance = oldHook?.memoizedState.instance ?? {
      committedSubscribe: null,
      getSnapshot,
      owner: null,
      unsubscribe: null,
      value,
    };
    const state: ExternalStoreState<T, F> = {
      getSnapshot,
      instance,
      subscribe,
      value,
    };

    appendHook(createHook("external-store", state));
    return value;
  }

  function updateReactiveEventHook<Args extends unknown[], Result>(
    handler: (...args: Args) => Result,
  ): (...args: ReactiveEventArgs<Args>) => Result {
    requireRenderingFiber();
    const oldHook = updateHook(
      "reactive-event",
    ) as Hook<ReactiveEventState> | null;
    const instance =
      oldHook?.memoizedState.instance ?? createReactiveEventInstance();

    appendHook(
      createHook("reactive-event", {
        instance,
        next: handler as ReactiveEventHandler,
      }),
    );
    return instance.stable as (...args: ReactiveEventArgs<Args>) => Result;
  }

  function createReactiveEventInstance(): ReactiveEventInstance {
    const instance: ReactiveEventInstance = {
      controller: null,
      handler: null,
      live: false,
      stable: (...args) => {
        if (renderingFiber !== null) {
          throw new Error(
            "Reactive events cannot be called while rendering a component.",
          );
        }

        const handler = instance.handler;
        if (handler === null) {
          throw new Error(
            "Reactive events cannot be called before their first commit.",
          );
        }

        instance.controller?.abort();
        instance.controller = new AbortController();
        if (!instance.live) instance.controller.abort();
        return handler(...args, instance.controller.signal);
      },
    };

    return instance;
  }

  function readExternalStoreSnapshot<T>(
    root: R,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T {
    if (!root.isHydrating) return getSnapshot();

    if (getServerSnapshot === undefined) {
      throw new Error(
        "useExternalStore requires getServerSnapshot during hydration.",
      );
    }

    return getServerSnapshot();
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

  function scheduleHookUpdate<S>(
    fiber: F,
    queue: HookQueue<S>,
    action: SetStateAction<S>,
    lane: Lane,
  ): void {
    lane = hiddenActivityLane(fiber, lane);
    const update: HookUpdate<S> = { action, lane, next: null as never };
    update.next = update;
    queue.pending = mergeQueues(queue.pending, update);
    scheduleFiber(fiber, lane);
  }

  // Updates inside hidden Activity boundaries are downgraded to the
  // offscreen lane at schedule time, so normal renders never descend for
  // hidden work and idle renders prerender it. A boundary mid-transition
  // (generations disagree) is treated as visible so updates are never
  // wrongly deferred.
  function hiddenActivityLane(node: F, lane: Lane): Lane {
    if (!hasHiddenActivities || lane === OffscreenLane) return lane;

    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (parent.tag === ActivityTag && parent.activityState?.hidden === true) {
        return OffscreenLane;
      }
    }

    return lane;
  }

  function createFiberId(root: R, fiber: F, localId: number): string {
    return `${root.identifierPrefix}fig-${fiberPath(fiber)}-${localId.toString(32)}`;
  }

  function fiberPath(fiber: F): string {
    const parts: string[] = [];

    for (
      let node: F | null = fiber;
      node !== null && node.tag !== RootTag;
      node = node.return
    ) {
      parts.push(node.index.toString(32));
    }

    return parts.reverse().join("-");
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
    kind: FigDevtoolsHookKind,
    phase: EffectPhase,
    create: EffectCallback,
    deps?: DependencyList,
  ): void {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook(kind) as Hook<Effect> | null;
    const nextDeps = deps ?? null;
    const previousEffect = oldHook?.memoizedState ?? null;
    const hasChanged =
      previousEffect === null ||
      previousEffect.controller === null ||
      previousEffect.controller.signal.aborted ||
      !areHookInputsEqual(nextDeps, previousEffect.deps);
    const effect: Effect = {
      phase,
      create,
      controller: previousEffect?.controller ?? null,
      deps: nextDeps,
      owner: fiber as Fiber<unknown, unknown, unknown>,
      strictRan:
        process.env.NODE_ENV !== "production" &&
        previousEffect?.strictRan === true,
    };
    const hook = createHook(kind, effect);

    appendHook(hook);

    if (hasChanged) {
      fiber.effects ??= [];
      fiber.effects.push(effect);
    }
  }

  function readContextValue<T>(context: FigContext<T>): T {
    if (renderingFiber === null) {
      throw new Error(
        "readContext can only be called while rendering a component.",
      );
    }

    addContextDependency(renderingFiber, context as FigContext<unknown>);

    for (
      let parent = renderingFiber.return;
      parent !== null;
      parent = parent.return
    ) {
      if (
        parent.tag === ContextProviderTag &&
        parent.type === (context as unknown as ElementType | null)
      ) {
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

  function updateHook(kind: FigDevtoolsHookKind): Hook | null {
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
    completeHydration(node);

    let child = node.child;
    let childLanes = NoLanes;

    while (child !== null) {
      childLanes = mergeLanes(childLanes, child.lanes);
      childLanes = mergeLanes(childLanes, child.childLanes);
      child = child.sibling;
    }

    if (isNewHostInstance(node)) {
      finalizeInitialHostInstance(node);
      if (!setInitialHostTextContent(node)) {
        appendAllHostChildren(node.stateNode as Instance, node.child);
      }
      if (host.appendInitialChild !== undefined) node.flags |= AssembledFlag;
    }

    node.childLanes = childLanes;
    node.memoizedProps = node.props;
  }

  function isNewHostInstance(node: F): boolean {
    // A host instance needs initial assembly until it has actually committed —
    // tracked by committedProps, not by alternate. A reused fiber from a
    // never-committed render (e.g. a Suspense primary subtree captured when a
    // child suspended, then revealed) has an alternate but null committedProps:
    // its host children were never appended into it, so it must assemble like a
    // fresh instance or its non-suspending descendants are dropped on reveal.
    return (
      node.tag === HostTag &&
      node.committedProps === null &&
      (node.flags & HydrationFlag) === 0
    );
  }

  function finalizeInitialHostInstance(node: F): void {
    host.finalizeInitialInstance?.(node.stateNode as Instance, node.props);
  }

  function setInitialHostTextContent(node: F): boolean {
    const text = hostTextContent(node.props.children);
    if (text === null || host.setTextContent === undefined) return false;

    host.setTextContent(node.stateNode as Instance, text);
    return true;
  }

  function appendAllHostChildren(parent: Instance, child: F | null): void {
    if (host.appendInitialChild === undefined) return;

    for (let node = child; node !== null; node = node.sibling) {
      if (node.tag === PortalTag) continue;

      if (node.tag === HostTag || node.tag === TextTag) {
        host.appendInitialChild(parent, hostNode(node));
      } else {
        appendAllHostChildren(parent, node.child);
      }
    }
  }

  function reconcileCurrentChildren(parent: F, children: FigNode): void {
    reconcile(parent, children, parent.alternate?.child ?? null, false);
  }

  function reconcile(
    parent: F,
    children: FigNode,
    currentFirstChild: F | null,
    forcePlacement: boolean,
  ): void {
    const nextChildren = collectChildren(children);
    const nextKeys: string[] = [];
    const seenKeys = new Set<string>();

    for (let index = 0; index < nextChildren.length; index += 1) {
      nextKeys.push(childKey(nextChildren[index], index, seenKeys));
    }

    parent.child = null;
    parent.deletions = null;

    let previous: F | null = null;
    let old: F | null = currentFirstChild;
    let index = 0;
    let lastPlacedIndex = 0;
    const isHydratingNewTree =
      parent.tag !== PortalTag &&
      rootOf(parent).isHydrating &&
      currentFirstChild === null;

    for (; old !== null && index < nextChildren.length; index += 1) {
      const child = nextChildren[index];
      if (fiberChildKey(old) !== nextKeys[index] || !sameType(old, child)) {
        break;
      }

      const next = createWorkInProgress(old, propsFor(child));
      next.index = index;
      next.return = parent;

      if (forcePlacement) {
        next.flags |= PlacementFlag | hostUpdateFlags(old, next.props);
      } else {
        next.flags |= hostUpdateFlags(old, next.props);
        lastPlacedIndex = old.index;
      }

      previous = appendChild(parent, previous, next);
      old = old.sibling;
    }

    if (index === nextChildren.length) {
      appendDeletions(parent, old);
      return;
    }

    if (old === null) {
      for (; index < nextChildren.length; index += 1) {
        const next = fiberFrom(nextChildren[index]);
        if (next === null) continue;

        next.index = index;
        next.return = parent;
        if (!isHydratingNewTree) next.flags |= PlacementFlag;
        previous = appendChild(parent, previous, next);
      }
      return;
    }

    const existing = new Map<string, F>();
    for (; old !== null; old = old.sibling) {
      existing.set(fiberChildKey(old), old);
    }

    for (; index < nextChildren.length; index += 1) {
      const child = nextChildren[index];
      const key = nextKeys[index];
      const matched = existing.get(key);
      const canReuse = matched !== undefined && sameType(matched, child);
      const next = canReuse
        ? createWorkInProgress(matched, propsFor(child))
        : fiberFrom(child);

      if (next === null) continue;

      next.index = index;
      next.return = parent;

      if (canReuse) {
        existing.delete(key);
        if (forcePlacement || matched.index < lastPlacedIndex) {
          next.flags |= PlacementFlag | hostUpdateFlags(matched, next.props);
        } else {
          next.flags |= hostUpdateFlags(matched, next.props);
          lastPlacedIndex = matched.index;
        }
      } else {
        if (!isHydratingNewTree) next.flags |= PlacementFlag;
      }

      previous = appendChild(parent, previous, next);
    }

    for (const child of existing.values()) {
      appendDeletion(parent, child);
    }
  }

  function appendDeletions(parent: F, firstChild: F | null): void {
    for (let child = firstChild; child !== null; child = child.sibling) {
      appendDeletion(parent, child);
    }
  }

  function appendDeletion(parent: F, child: F): void {
    parent.deletions ??= [];
    parent.deletions.push(child);
  }

  function hostUpdateFlags(current: F, nextProps: Props): Flag {
    if (current.tag === TextTag) {
      return current.committedProps?.nodeValue !== nextProps.nodeValue
        ? UpdateFlag
        : NoFlags;
    }

    if (current.tag !== HostTag) return NoFlags;

    const previousProps = current.committedProps ?? {};
    let flags = NoFlags;

    if (hostPropsChanged(previousProps, nextProps)) {
      flags |= UpdateFlag;
    }
    if (
      host.shouldCommitUpdate?.(String(current.type), previousProps, nextProps)
    ) {
      flags |= UpdateFlag;
    }
    if (hostTextContentChanged(current, previousProps, nextProps)) {
      flags |= TextContentFlag;
    }

    return flags;
  }

  function hostTextContentChanged(
    current: F,
    previous: Props,
    next: Props,
  ): boolean {
    if (host.setTextContent === undefined) return false;
    if (hasUnsafeHTML(next)) return false;

    const previousText = hostTextContent(previous.children);
    const nextText = hostTextContent(next.children);

    return (
      previousText !== nextText || (nextText !== null && current.child !== null)
    );
  }

  function hostPropsChanged(previous: Props, next: Props): boolean {
    let previousCount = 0;

    for (const key of Object.keys(previous)) {
      if (!committedHostProp(key)) continue;
      previousCount += 1;
      if (!(key in next) || previous[key] !== next[key]) return true;
    }

    let nextCount = 0;

    for (const key of Object.keys(next)) {
      if (committedHostProp(key)) nextCount += 1;
    }

    return previousCount !== nextCount;
  }

  function committedHostProp(name: string): boolean {
    return name !== "children";
  }

  function commitRoot(root: R, finishedWork: F): void {
    commitLiveHookInstances(finishedWork.child);
    if (hasHiddenActivities) armRevealedActivities(finishedWork.child);
    commitEffects(finishedWork.child, BeforeLayoutEffect);
    if (root.clearContainerBeforeCommit) {
      requireHydrationHostConfig().clearContainer(root.container);
      root.clearContainerBeforeCommit = false;
    }
    commitDeletions(finishedWork);
    commitDataDependencies(finishedWork.child);
    commitMutationEffects(finishedWork.child);
    if (hasHiddenActivities) commitActivityVisibility(finishedWork.child);
    root.current = finishedWork;
    deactivateHydration(root);
    root.hydrationInitialElement = NoHydrationInitialElement;
    root.consumedPendingQueues = [];
    markRootFinished(root, root.pendingLanes & ~root.renderLanes);
    if (includesSomeLane(finishedWork.childLanes, OffscreenLane)) {
      markRootPending(root, OffscreenLane);
      // A suspension after reveal lane expansion may have marked offscreen
      // work suspended alongside the visible lanes; let idle retries proceed.
      root.suspendedLanes &= ~OffscreenLane;
    }
    try {
      commitExternalStores(finishedWork.child);
      scheduleDehydratedSuspenseRetries(root);
      commitEffects(finishedWork.child, BeforePaintEffect);
      flushCaughtBoundaryErrors(root, finishedWork.child);
    } finally {
      // Once the tree is current its flags must be cleared even when a
      // commit step throws, or a later render would adopt stale flags.
      collectReactiveEffects(root, finishedWork.child);
      scheduleReactiveEffects(root);
    }
    if (process.env.NODE_ENV !== "production" && root.devtools) {
      emitDevtoolsCommit(host, root);
    }
    flushRecoverableErrors(root);
  }

  function scheduleDehydratedSuspenseRetries(root: R): void {
    const boundaries: F[] = [];
    collectRetriableDehydratedSuspense(root.current.child, boundaries);
    if (boundaries.length === 0) return;

    queueMicrotask(() => {
      for (const boundary of boundaries) {
        const state = boundary.suspenseState;
        if (state?.kind !== "dehydrated") continue;

        const lane = dehydratedSuspenseRetryLane(state.boundary);
        if (lane !== NoLane) scheduleFiber(boundary, lane);
      }
    });
  }

  function collectRetriableDehydratedSuspense(
    node: F | null,
    boundaries: F[],
  ): void {
    if (node === null) return;

    if (node.suspenseState?.kind === "dehydrated") {
      if (
        !abandonedHydrationBoundaries.has(node) &&
        dehydratedSuspenseRetryLane(node.suspenseState.boundary) !== NoLane
      ) {
        boundaries.push(node);
      }
      return;
    }

    collectRetriableDehydratedSuspense(node.child, boundaries);
    collectRetriableDehydratedSuspense(node.sibling, boundaries);
  }

  function dehydratedSuspenseRetryLane(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): Lane {
    if (boundary.forceClientRender) return DefaultLane;
    if (boundary.status === "completed") return DefaultHydrationLane;
    if (boundary.status === "client-rendered") return DefaultLane;
    return NoLane;
  }

  function flushRecoverableErrors(root: R): void {
    const errors = root.recoverableErrors;
    if (errors.length === 0) return;

    root.recoverableErrors = [];

    for (const { error, info } of errors) {
      try {
        root.onRecoverableError(error, info);
      } catch {
        // Recoverable error reporting should not break a successful commit.
      }
    }
  }

  function flushCaughtBoundaryErrors(root: R, node: F | null): void {
    if (node === null) return;

    flushCaughtBoundaryError(root, node);
    flushCaughtBoundaryErrors(root, node.child);
    flushCaughtBoundaryErrors(root, node.sibling);
  }

  function flushCaughtBoundaryError(root: R, node: F): void {
    if (
      node.tag !== ErrorBoundaryTag ||
      node.errorBoundaryState === null ||
      node.errorBoundaryState.didReport
    ) {
      return;
    }

    const state = node.errorBoundaryState;
    state.didReport = true;
    if (node.alternate !== null) node.alternate.errorBoundaryState = state;

    const onError = node.props.onError;
    if (typeof onError !== "function") return;

    try {
      (onError as (error: unknown, info: ErrorInfo) => void)(
        state.error,
        state.info,
      );
    } catch (error) {
      reportUncaughtError(root, error, errorInfoFor(node, error));
    }
  }

  function reportUncaughtError(root: R, error: unknown, info: ErrorInfo): void {
    try {
      root.onUncaughtError?.(error, info);
    } catch {
      // Error reporting should not corrupt already-failed recovery work.
    }
  }

  function clearRootAfterUncaughtError(root: R): void {
    root.reactiveCallback?.cancel();
    root.reactiveCallback = null;
    root.pendingReactiveEffects = [];
    root.element = null;

    if (root.current.child !== null) {
      deleteFiberData(root.current.child);
      abortFiberEffects(root.current);
    }

    if (host.clearContainer !== undefined) {
      removePortalDescendants(root.current.child);
      host.clearContainer(root.container);
    } else if (root.current.child !== null) {
      let child: F | null = root.current.child;
      while (child !== null) {
        const next: F | null = child.sibling;
        remove(child, root.container);
        child = next;
      }
    }

    const current = fiber(RootTag, null, null, { children: null }, root);
    current.memoizedProps = current.props;
    current.committedProps = current.props;
    root.current = current;
    resetRootWork(root);
    root.clearContainerBeforeCommit = false;
    root.hydrationInitialElement = NoHydrationInitialElement;
    root.consumedPendingQueues = [];
    markRootFinished(root, NoLanes);
    pendingRoots.delete(root);
  }

  function commitMutationEffects(node: F | null, hidden = false): void {
    let cursor = node;

    while (cursor !== null) {
      if ((cursor.flags & PlacementFlag) !== 0) {
        cursor = commitPlacementRun(cursor, hidden);
        continue;
      }

      if (cursor.tag === PortalTag) {
        commitPortal(cursor);
      }

      if (cursor.tag === ActivityTag && (cursor.flags & HydrationFlag) !== 0) {
        commitHydratedActivityBoundary(cursor);
      }

      if (
        (cursor.flags & (UpdateFlag | TextContentFlag)) !== 0 &&
        isHost(cursor)
      ) {
        const hostFiber = cursor;
        commitHostMutation(hostFiber, () => commitUpdate(hostFiber));
        // Prerendered mutations inside hidden trees must stay hidden.
        if (hidden) hideHostFiber(hostFiber);
      }

      if ((cursor.flags & AdoptedFlag) === 0) {
        commitMutationEffects(cursor.child, hidden || isHiddenActivity(cursor));
      }

      if (cursor.tag === SuspenseTag && (cursor.flags & HydrationFlag) !== 0) {
        commitHydratedSuspenseBoundary(cursor);
      }

      cursor = cursor.sibling;
    }
  }

  function commitPlacementRun(firstPlaced: F, hidden: boolean): F | null {
    const lastPlaced = placementRunTail(firstPlaced);
    const afterPlaced = lastPlaced.sibling;
    const before = hostSibling(lastPlaced);

    for (let placed: F | null = firstPlaced; placed !== afterPlaced; ) {
      if (placed === null) break;

      const current: F = placed;
      const next: F | null = current.sibling;
      commitHostMutation(current, () => commitPlacement(current, before));
      if (hidden) setNodeVisibility(current, true);
      if (!isPreassembledHostSubtree(current)) {
        commitMutationEffects(current.child, hidden);
      } else {
        commitPortalsInPreassembledSubtree(current.child, hidden);
      }
      placed = next;
    }

    return afterPlaced;
  }

  function commitPortalsInPreassembledSubtree(
    node: F | null,
    hidden: boolean,
  ): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if (cursor.tag === PortalTag) {
        commitHostMutation(cursor, () => commitPlacement(cursor));
        if (hidden) setNodeVisibility(cursor, true);
        commitMutationEffects(cursor.child, hidden);
      } else {
        commitPortalsInPreassembledSubtree(cursor.child, hidden);
      }
    }
  }

  function commitHostMutation(source: F, mutation: () => void): void {
    try {
      mutation();
    } catch (error) {
      rootOf(source).uncaughtErrorInfo = errorInfoFor(source, error);
      throw error;
    }
  }

  function isPreassembledHostSubtree(node: F): boolean {
    return (node.flags & AssembledFlag) !== 0;
  }

  function placementRunTail(node: F): F {
    let tail = node;
    while (
      tail.sibling !== null &&
      (tail.sibling.flags & PlacementFlag) !== 0
    ) {
      tail = tail.sibling;
    }
    return tail;
  }

  function commitPlacement(
    node: F,
    before: HostNode<Instance, TextInstance> | null = hostSibling(node),
  ): void {
    if (isHost(node)) {
      if (shouldCommitPlacementUpdate(node)) commitUpdate(node);
      host.insertBefore(hostParent(node), hostNode(node), before);
      markHostCommitted(node);
      if (isPreassembledHostSubtree(node)) markHostSubtreeCommitted(node.child);
    } else if (node.tag === PortalTag) {
      commitPortal(node);
      if (node.alternate !== null) insertPortalChildren(node);
    } else if (node.alternate !== null) {
      insertHostSubtree(node, hostParent(node), before);
    }
  }

  function commitPortal(node: F): void {
    host.preparePortalContainer?.(
      portalTarget(node),
      rootOf(node).container,
      hostParent(node),
    );
  }

  function shouldCommitPlacementUpdate(node: F): boolean {
    if ((node.flags & (UpdateFlag | TextContentFlag)) !== 0) return true;
    if (node.alternate !== null || node.tag === TextTag) return false;
    return host.finalizeInitialInstance === undefined;
  }

  function insertHostSubtree(
    node: F,
    parent: Parent<Container, Instance>,
    before: HostNode<Instance, TextInstance> | null,
  ): void {
    visitHostNodes(node, (child) => host.insertBefore(parent, child, before));
  }

  function insertPortalChildren(node: F): void {
    const parent = portalTarget(node);
    for (let child = node.child; child !== null; child = child.sibling) {
      visitHostNodes(child, (hostChild) =>
        host.insertBefore(parent, hostChild, null),
      );
    }
  }

  function commitUpdate(node: F): void {
    if (node.tag === TextTag) {
      host.commitTextUpdate(
        node.stateNode as TextInstance,
        String(node.props.nodeValue),
      );
    } else if (
      (node.flags & HydrationFlag) !== 0 &&
      host.commitHydratedInstance !== undefined
    ) {
      host.commitHydratedInstance(node.stateNode as Instance, node.props);
    } else {
      const previousProps = previousCommittedProps(node);

      if ((node.flags & UpdateFlag) !== 0) {
        host.commitUpdate(
          node.stateNode as Instance,
          previousProps,
          node.props,
        );
      }

      if ((node.flags & TextContentFlag) !== 0) {
        commitHostTextContent(node, previousProps);
      }
    }

    markHostCommitted(node);
  }

  function commitHydratedSuspenseBoundary(node: F): void {
    const boundary = dehydratedSuspenseBoundary(node.alternate);

    if (boundary === null) return;
    host.commitHydratedSuspenseBoundary?.(boundary);
  }

  function commitHydratedActivityBoundary(node: F): void {
    const state = node.activityState;
    if (state?.dehydrated == null) return;

    requireActivityHydrationHostConfig().commitHydratedActivityBoundary(
      state.dehydrated,
    );
    state.dehydrated = null;
  }

  function commitHostTextContent(node: F, previousProps: Props): void {
    if (host.setTextContent === undefined || node.tag !== HostTag) return;

    const nextText = hostTextContent(node.props.children);
    if (nextText !== null) {
      host.setTextContent(node.stateNode as Instance, nextText);
    } else if (hostTextContent(previousProps.children) !== null) {
      host.setTextContent(node.stateNode as Instance, "");
    }
  }

  function previousCommittedProps(node: F): Props {
    return (
      node.committedProps ??
      node.alternate?.committedProps ??
      node.alternate?.memoizedProps ??
      {}
    );
  }

  function markHostCommitted(node: F): void {
    if (!isHost(node)) return;
    node.committedProps = node.props;
    if (node.alternate !== null) node.alternate.committedProps = node.props;
  }

  function markHostSubtreeCommitted(node: F | null): void {
    for (let child = node; child !== null; child = child.sibling) {
      markHostCommitted(child);
      markHostSubtreeCommitted(child.child);
    }
  }

  function commitDeletions(node: F): void {
    if (node.deletions !== null) {
      const parent = isHostParent(node)
        ? hostParentFor(node)
        : hostParent(node);
      for (const child of node.deletions) {
        deleteFiberData(child);
        abortFiberEffects(child);
        remove(child, parent);
      }
      node.deletions = null;
    }

    if ((node.flags & AdoptedFlag) !== 0) return;

    for (let child = node.child; child !== null; child = child.sibling) {
      commitDeletions(child);
    }
  }

  function commitDataDependencies(node: F | null): void {
    let cursor = node;

    while (cursor !== null) {
      if (cursor.dataDependenciesDirty) {
        rootOf(cursor).dataStore.commitDataDependencies(
          cursor,
          cursor.alternate,
        );
        cursor.dataDependenciesDirty = false;
        if (cursor.alternate !== null)
          cursor.alternate.dataDependenciesDirty = false;
      }

      if ((cursor.flags & AdoptedFlag) === 0) {
        commitDataDependencies(cursor.child);
      }

      cursor = cursor.sibling;
    }
  }

  function deleteFiberData(node: F): void {
    const store = rootOf(node).dataStore;
    deleteFiberDataFromStore(node, store);
  }

  function deleteFiberDataFromStore(node: F, store: R["dataStore"]): void {
    store.releaseDataOwner(node);
    if (node.alternate !== null) store.releaseDataOwner(node.alternate);

    for (let child = node.child; child !== null; child = child.sibling) {
      deleteFiberDataFromStore(child, store);
    }
  }

  function dehydratedActivityBoundary(node: F): Instance | null {
    return node.tag === ActivityTag
      ? (node.activityState?.dehydrated ?? null)
      : null;
  }

  function remove(node: F, parent: Parent<Container, Instance>): void {
    const dehydratedActivity = dehydratedActivityBoundary(node);
    if (dehydratedActivity !== null) {
      host.removeChild(parent, dehydratedActivity);
      return;
    }

    const boundary = dehydratedSuspenseBoundary(node);
    if (
      boundary !== null &&
      host.removeDehydratedSuspenseBoundary !== undefined
    ) {
      host.removeDehydratedSuspenseBoundary(boundary);
      return;
    }

    if (node.tag === PortalTag) {
      removePortalChildren(node);
      host.removePortalContainer?.(portalTarget(node));
      return;
    }

    if (isHost(node)) {
      removePortalDescendants(node.child);
      host.removeChild(parent, hostNode(node));
      return;
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      remove(child, parent);
    }
  }

  function removePortalChildren(node: F): void {
    const parent = portalTarget(node);
    for (let child = node.child; child !== null; child = child.sibling) {
      remove(child, parent);
    }
  }

  function removePortalDescendants(node: F | null): void {
    for (let child = node; child !== null; child = child.sibling) {
      if (child.tag === PortalTag) {
        removePortalChildren(child);
        host.removePortalContainer?.(portalTarget(child));
      } else {
        removePortalDescendants(child.child);
      }
    }
  }

  function visitHostNodes(
    node: F,
    visitor: (node: HostNode<Instance, TextInstance>) => void,
  ): void {
    if (isHost(node)) {
      visitor(hostNode(node));
      return;
    }

    if (node.tag === PortalTag) return;

    for (let child = node.child; child !== null; child = child.sibling) {
      visitHostNodes(child, visitor);
    }
  }

  function hostParent(node: F): Parent<Container, Instance> {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (isHostParent(parent)) return hostParentFor(parent);
    }

    throw new Error("Could not find a host parent for fiber.");
  }

  function hostSibling(node: F): HostNode<Instance, TextInstance> | null {
    const dehydratedBoundary = dehydratedSuspenseParent(node);
    if (dehydratedBoundary !== null) return dehydratedBoundary.start;

    let cursor: F = node;

    search: while (true) {
      while (cursor.sibling === null) {
        if (cursor.return === null || isHostParent(cursor.return)) {
          return null;
        }
        cursor = cursor.return;
      }

      cursor = cursor.sibling;

      while (!isHost(cursor)) {
        const dehydratedActivity = dehydratedActivityBoundary(cursor);
        if (dehydratedActivity !== null) return dehydratedActivity;

        if (
          cursor.tag === PortalTag ||
          (cursor.flags & PlacementFlag) !== 0 ||
          cursor.child === null
        ) {
          continue search;
        }
        cursor = cursor.child;
      }

      if ((cursor.flags & PlacementFlag) === 0) return hostNode(cursor);
    }
  }

  function dehydratedSuspenseParent(
    node: F,
  ): DehydratedSuspenseBoundary<Instance, TextInstance> | null {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if ((parent.flags & HydrationFlag) !== 0) {
        const boundary = dehydratedSuspenseBoundary(parent.alternate);
        if (
          boundary !== null &&
          (boundary.status !== "completed" || boundary.forceClientRender)
        ) {
          return boundary;
        }
      }

      if (isHostParent(parent)) return null;
    }

    return null;
  }

  function isHostParent(node: F): boolean {
    return (
      node.tag === RootTag || node.tag === HostTag || node.tag === PortalTag
    );
  }

  function hostParentFor(node: F): Parent<Container, Instance> {
    if (node.tag === RootTag) return (node.stateNode as R).container;
    if (node.tag === HostTag) return node.stateNode as Instance;
    return portalTarget(node);
  }

  function dehydratedSuspenseBoundary(
    node: F | null | undefined,
  ): DehydratedSuspenseBoundary<Instance, TextInstance> | null {
    if (node?.tag !== SuspenseTag) return null;
    return node.suspenseState?.kind === "dehydrated"
      ? node.suspenseState.boundary
      : null;
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

  function findSuspenseBoundary(node: F): F | null {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (parent.tag === SuspenseTag && parent.suspenseState === null) {
        return parent;
      }
    }

    return null;
  }

  function findErrorBoundary(node: F): F | null {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (
        parent.tag === ErrorBoundaryTag &&
        parent.errorBoundaryState === null
      ) {
        return parent;
      }
    }

    return null;
  }

  function captureSuspenseBoundary(boundary: F, thenable: Thenable): F | null {
    const root = rootOf(boundary);
    const lanes = root.renderLanes;
    attachSuspensePing(root, boundary, thenable, lanes);

    const dehydrated = boundary.alternate?.suspenseState;
    if (
      root.hydratingSuspenseBoundary === boundary &&
      dehydrated?.kind === "dehydrated"
    ) {
      // Hydrating this boundary suspended. Abandon the attempt and stay
      // dehydrated so the server-rendered content survives; the attached ping
      // retries hydration once the thenable settles, so commit-time retry
      // scheduling must skip the boundary until then.
      leaveSuspenseHydration(root, boundary, dehydrated.boundary);
      boundary.suspenseState = dehydrated;
      boundary.flags &= ~HydrationFlag;
      boundary.child = null;
      abandonedHydrationBoundaries.add(boundary);
      if (boundary.alternate !== null) {
        abandonedHydrationBoundaries.add(boundary.alternate);
      }
      return completeUnit(boundary);
    }

    if (shouldPreserveSuspenseBoundary(root, boundary)) {
      markRootSuspended(root, lanes);
      throw PreservedSuspense;
    }

    boundary.suspenseState = {
      kind: "fallback",
      primaryChild: boundary.child,
    };
    reconcileCurrentChildren(boundary, boundary.props.fallback as FigNode);
    return boundary.child ?? completeUnit(boundary);
  }

  function captureErrorBoundary(
    boundary: F,
    error: unknown,
    source: F,
  ): F | null {
    boundary.errorBoundaryState = createErrorBoundaryState(error, source);
    reconcileCurrentChildren(boundary, boundary.props.fallback as FigNode);
    return boundary.child ?? completeUnit(boundary);
  }

  function captureCommittedErrorBoundary(
    boundary: F,
    error: unknown,
    source: F,
  ): void {
    const state = createErrorBoundaryState(error, source);
    boundary.errorBoundaryState = state;
    if (boundary.alternate !== null)
      boundary.alternate.errorBoundaryState = state;
  }

  function createErrorBoundaryState(
    error: unknown,
    source: F,
  ): ErrorBoundaryState {
    return {
      error,
      info: errorInfoFor(source, error),
      didReport: false,
    };
  }

  function shouldPreserveSuspenseBoundary(root: R, boundary: F): boolean {
    return (
      boundary.alternate !== null &&
      boundary.alternate.suspenseState === null &&
      isTransitionOrDeferredRender(root)
    );
  }

  function attachSuspensePing(
    root: R,
    boundary: F,
    thenable: Thenable,
    lanes: Lanes,
  ): void {
    if (lanes === NoLanes) return;

    let pings = root.suspendedBoundaries.get(thenable);
    const shouldAttach = pings === undefined;

    if (pings === undefined) {
      pings = new WeakMap();
      root.suspendedBoundaries.set(thenable, pings);
    }

    pings.set(boundary, mergeLanes(pings.get(boundary) ?? NoLanes, lanes));

    if (!shouldAttach) return;

    thenable.then(
      () => pingSuspenseBoundaries(root, thenable),
      () => pingSuspenseBoundaries(root, thenable),
    );
  }

  function pingSuspenseBoundaries(root: R, thenable: object): void {
    const pings = root.suspendedBoundaries.get(thenable);
    if (pings === undefined) return;

    root.suspendedBoundaries.delete(thenable);
    pingCurrentSuspenseBoundaries(root.current, pings);
  }

  function pingCurrentSuspenseBoundaries(
    node: F,
    pings: SuspensePings<Container, Instance, TextInstance>,
  ): void {
    const lanes = mergeLanes(
      pings.get(node) ?? NoLanes,
      node.alternate === null
        ? NoLanes
        : (pings.get(node.alternate) ?? NoLanes),
    );

    if (lanes !== NoLanes) {
      scheduleFiber(node, suspenseRetryLane(lanes));
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      pingCurrentSuspenseBoundaries(child, pings);
    }
  }

  function propagateContextChange(provider: F): void {
    const currentProvider = provider.alternate;
    if (currentProvider === null) return;

    const context = provider.type as unknown as FigContext<unknown>;
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
    if (
      node.tag === ContextProviderTag &&
      node.type === (context as unknown as ElementType | null)
    ) {
      return;
    }

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
    next.committedProps = current.committedProps;
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
    next.dataDependenciesDirty = false;
    next.suspenseState = current.suspenseState;
    next.errorBoundaryState = current.errorBoundaryState;
    next.activityState = current.activityState;
    next.alternate = current;
    current.alternate = next;

    return next;
  }

  function cloneChildFibers(parent: F): void {
    let current = parent.alternate?.child ?? null;
    let previous: F | null = null;
    parent.child = null;
    parent.deletions = null;

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

    if (isPortal(child)) {
      return fiber(PortalTag, null, child.key, portalProps(child), null);
    }

    if (!isValidElement(child)) return null;

    return fiber(tagFor(child), child.type, child.key, child.props, null);
  }

  function portalTarget(node: F): Parent<Container, Instance> {
    return node.props.target as Parent<Container, Instance>;
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
      committedProps: null,
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
      dataDependenciesDirty: false,
      suspenseState: null,
      errorBoundaryState: null,
      activityState: null,
    };
  }

  function rootOf(node: F): R {
    for (let parent: F | null = node; parent !== null; parent = parent.return) {
      if (parent.tag === RootTag) return parent.stateNode as R;
    }

    throw new Error("Could not find a root for fiber.");
  }

  function errorInfoFor(node: F, error?: unknown): ErrorInfo {
    const dataResourceKeys =
      error === undefined ? undefined : dataResourceKeysForError(error);

    return dataResourceKeys === undefined
      ? { componentStack: componentStackFor(node) }
      : { componentStack: componentStackFor(node), dataResourceKeys };
  }

  function queueRecoverableError(
    root: R,
    node: F,
    error: unknown,
    details: RecoverableDetails,
  ): void {
    root.recoverableErrors.push({
      error,
      info: { ...details, componentStack: componentStackFor(node) },
    });
  }

  function componentStackFor(node: F): string {
    const frames: string[] = [];

    for (let fiber: F | null = node; fiber !== null; fiber = fiber.return) {
      const name = componentStackName(fiber);
      if (name !== null) frames.push(`    at ${name}`);
    }

    return frames.length === 0 ? "" : `\n${frames.join("\n")}`;
  }

  function componentStackName(node: F): string | null {
    switch (node.tag) {
      case FunctionTag:
        return devtoolsTypeName(node.type, "Anonymous");
      case ContextProviderTag:
        return `${devtoolsTypeName(node.type, "Context")}.Provider`;
      case SuspenseTag:
        return "Suspense";
      case ErrorBoundaryTag:
        return "ErrorBoundary";
      case PortalTag:
        return "Portal";
      case ResourcesTag:
        return "Resources";
      default:
        return null;
    }
  }

  return {
    batchedUpdates,
    createRoot,
    hydrateRoot,
    hydrateTarget,
    render,
    flushSync,
    scheduleRefresh,
  };

  // Re-render every mounted instance of a changed component family. Updated
  // families re-render in place (hook state preserved); stale families (hook
  // signature changed) remount via their parent. The refresh runtime swaps each
  // family's `current` before calling this.
  function scheduleRefresh(update: RefreshUpdate): void {
    if (resolveFamily === null || mountedRoots.size === 0) return;

    staleFamilies = update.staleFamilies;
    try {
      flushSync(() => {
        for (const root of mountedRoots) {
          scheduleFamilyRefresh(root.current.child, update);
        }
      });
    } finally {
      staleFamilies = null;
    }
  }

  function scheduleFamilyRefresh(node: F | null, update: RefreshUpdate): void {
    if (node === null) return;

    if (node.tag === FunctionTag && resolveFamily !== null) {
      const family = resolveFamily(node.type);
      if (family !== undefined) {
        if (update.staleFamilies.has(family)) {
          remountForRefresh(node);
        } else if (update.updatedFamilies.has(family)) {
          // Mark the instance dirty so render bailouts don't skip it.
          scheduleFiber(node, SyncLane);
        }
      }
    }

    scheduleFamilyRefresh(node.child, update);
    scheduleFamilyRefresh(node.sibling, update);
  }

  // A stale component must drop its hook state. Re-render its parent so the
  // child reconciles as an incompatible type and remounts; for a top-level
  // component re-render the whole root.
  function remountForRefresh(node: F): void {
    const parent = node.return;
    if (parent === null || parent.tag === RootTag) {
      const root = rootOf(node);
      updateRoot(root, root.element);
    } else {
      scheduleFiber(parent, SyncLane);
    }
  }

  function findDehydratedSuspenseBoundaryForTarget(
    node: F | null,
    target: unknown,
  ): F | null {
    if (node === null || host.isTargetWithinSuspenseBoundary === undefined) {
      return null;
    }

    const state = node.suspenseState;
    if (
      state?.kind === "dehydrated" &&
      host.isTargetWithinSuspenseBoundary(target, state.boundary)
    ) {
      return node;
    }

    return (
      findDehydratedSuspenseBoundaryForTarget(node.child, target) ??
      findDehydratedSuspenseBoundaryForTarget(node.sibling, target)
    );
  }

  function isHiddenActivity(node: F): boolean {
    return node.tag === ActivityTag && activityHidden(node.props);
  }

  function requireActivityHostConfig(): HostConfig<
    Container,
    Instance,
    TextInstance
  > &
    Required<
      Pick<
        HostConfig<Container, Instance, TextInstance>,
        | "hideInstance"
        | "unhideInstance"
        | "hideTextInstance"
        | "unhideTextInstance"
      >
    > {
    if (activityHostConfig !== null) return activityHostConfig;

    if (
      host.hideInstance === undefined ||
      host.unhideInstance === undefined ||
      host.hideTextInstance === undefined ||
      host.unhideTextInstance === undefined
    ) {
      throw new Error("Activity is not supported by this renderer.");
    }

    activityHostConfig = host as ReturnType<typeof requireActivityHostConfig>;
    return activityHostConfig;
  }

  function commitActivityVisibility(node: F | null): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if ((cursor.flags & AdoptedFlag) !== 0) continue;

      if (cursor.tag === ActivityTag && (cursor.flags & VisibilityFlag) !== 0) {
        const hidden = activityHidden(cursor.props);
        const state = cursor.activityState;
        if (state !== null) state.hidden = hidden;
        setActivityVisibility(cursor.child, hidden);
        if (hidden && cursor.child !== null) abortFiberEffects(cursor.child);
        if (!hidden && includesSomeLane(cursor.childLanes, OffscreenLane)) {
          // Pending hidden work upgrades to prompt processing on reveal.
          const root = rootOf(cursor);
          markRootPending(root, DefaultLane);
          markRootEntangled(root, DefaultLane | OffscreenLane);
          scheduleOrBatchRoot(root);
        }
      }

      commitActivityVisibility(cursor.child);
    }
  }

  function setActivityVisibility(node: F | null, hidden: boolean): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      setNodeVisibility(cursor, hidden);
    }
  }

  function setNodeVisibility(cursor: F, hidden: boolean): void {
    // Subtrees hidden by their own boundary keep their visibility.
    if (isHiddenActivity(cursor)) return;

    if (cursor.tag === HostTag) {
      const activityHost = requireActivityHostConfig();
      if (hidden) activityHost.hideInstance(cursor.stateNode as Instance);
      else {
        activityHost.unhideInstance(cursor.stateNode as Instance, cursor.props);
      }
    } else if (cursor.tag === TextTag) {
      const activityHost = requireActivityHostConfig();
      if (hidden) {
        activityHost.hideTextInstance(cursor.stateNode as TextInstance);
      } else {
        activityHost.unhideTextInstance(
          cursor.stateNode as TextInstance,
          String(cursor.props.nodeValue),
        );
      }
    }

    setActivityVisibility(cursor.child, hidden);
  }

  function hideHostFiber(node: F): void {
    const activityHost = requireActivityHostConfig();
    if (node.tag === HostTag) {
      activityHost.hideInstance(node.stateNode as Instance);
    } else {
      activityHost.hideTextInstance(node.stateNode as TextInstance);
    }
  }

  function armRevealedActivities(node: F | null): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if ((cursor.flags & AdoptedFlag) !== 0) continue;

      if (
        cursor.tag === ActivityTag &&
        (cursor.flags & VisibilityFlag) !== 0 &&
        !activityHidden(cursor.props) &&
        cursor.child !== null
      ) {
        armDeferredEffects(cursor.child);
      }

      armRevealedActivities(cursor.child);
    }
  }

  // Re-arms effects that were deferred or aborted while hidden so the
  // regular commit phases run them in order during the reveal commit.
  function armDeferredEffects(node: F): void {
    visitFiberHooks(node, (owner, hook) => {
      if (!isEffectHook(hook.kind)) return;

      const effect = hook.memoizedState as Effect;
      if (effect.controller !== null) return;

      const effects = (owner.effects ??= []);
      if (!effects.includes(effect)) effects.push(effect);
    });
  }

  function commitLiveHookInstances(node: F | null): void {
    visitFiberHooks(node, (_owner, hook) => {
      if (isReactiveEventHook(hook)) {
        const instance = hook.memoizedState.instance;
        instance.handler = hook.memoizedState.next;
        instance.live = true;
      }

      if (hook.kind === "action-state") {
        const state = hook.memoizedState as ActionState<unknown, unknown[]>;
        state.instance.action = state.action;
        state.instance.value = state.value;
      }
    });
  }

  function isReactiveEventHook(hook: Hook): hook is Hook<ReactiveEventState> {
    return hook.kind === "reactive-event";
  }

  function commitExternalStores(node: F | null): void {
    if (node === null) return;

    for (let hook = node.memoizedState; hook !== null; hook = hook.next) {
      if (isExternalStoreHook(hook))
        commitExternalStore(node, hook.memoizedState);
    }

    // Subscriptions under hidden boundaries are deferred until reveal.
    if (!isHiddenActivity(node)) commitExternalStores(node.child);
    commitExternalStores(node.sibling);
  }

  function commitExternalStore(
    owner: F,
    state: ExternalStoreState<unknown, F>,
  ): void {
    const instance = state.instance;

    if (instance.committedSubscribe !== state.subscribe) {
      instance.unsubscribe?.();
      instance.unsubscribe = null;
      instance.committedSubscribe = state.subscribe;
    }

    instance.getSnapshot = state.getSnapshot;
    instance.owner = owner;
    instance.value = state.value;
    instance.unsubscribe ??= state.subscribe(() => {
      scheduleExternalStoreIfChanged(instance.owner, instance);
    });

    scheduleExternalStoreIfChanged(owner, instance);
  }

  function scheduleExternalStoreIfChanged(
    owner: F | null,
    instance: ExternalStoreInstance<unknown, F>,
  ): void {
    if (owner === null) return;

    const latestValue = instance.getSnapshot();
    if (!Object.is(latestValue, instance.value)) scheduleFiber(owner, SyncLane);
  }

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
    const adopted = (node.flags & AdoptedFlag) !== 0;
    // The last flag consumer in the commit clears them, so committed trees
    // stay flag-clean and adopted subtrees never expose stale commit state.
    node.flags = NoFlags;
    if (!adopted) {
      if (isHiddenActivity(node)) clearHiddenSubtreeFlags(node.child);
      else collectReactiveEffects(root, node.child);
    }
    collectReactiveEffects(root, node.sibling);
  }

  // Hidden subtrees keep their deferred fiber.effects for reveal, but their
  // flags must still be cleared to keep committed trees flag-clean. Reveal
  // arming depends on those effect arrays surviving every commit while
  // hidden; no walk may null them below a hidden boundary.
  function clearHiddenSubtreeFlags(node: F | null): void {
    if (node === null) return;

    const adopted = (node.flags & AdoptedFlag) !== 0;
    node.flags = NoFlags;
    if (!adopted) clearHiddenSubtreeFlags(node.child);
    clearHiddenSubtreeFlags(node.sibling);
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

    if ((node.flags & AdoptedFlag) === 0 && !isHiddenActivity(node)) {
      visitEffects(node.child, visitor);
    }
    visitEffects(node.sibling, visitor);
  }

  // Deliberately traverses adopted subtrees: unmount aborts and commit-time
  // external store checks must reach hooks that did not re-render.
  function visitFiberHooks(
    node: F | null,
    visitor: (owner: F, hook: Hook) => void,
  ): void {
    if (node === null) return;

    for (let hook = node.memoizedState; hook !== null; hook = hook.next) {
      visitor(node, hook);
    }

    visitFiberHooks(node.child, visitor);
    visitFiberHooks(node.sibling, visitor);
  }

  function isExternalStoreHook(
    hook: Hook,
  ): hook is Hook<ExternalStoreState<unknown, F>> {
    return hook.kind === "external-store";
  }

  function runEffect(effect: Effect): void {
    let runStrict = false;
    if (process.env.NODE_ENV !== "production") {
      // Marked before create so renders nested inside the effect carry it
      // forward and never re-enter the strict cycle.
      runStrict = !effect.strictRan;
      effect.strictRan = true;
    }
    abortEffect(effect);
    effect.controller = new AbortController();
    try {
      effect.create(effect.controller.signal);
      if (process.env.NODE_ENV !== "production" && runStrict) {
        // Strict re-run: abort and re-invoke first-time effects so work that
        // ignores its AbortSignal surfaces in development.
        abortEffect(effect);
        effect.controller = new AbortController();
        effect.create(effect.controller.signal);
      }
    } catch (error) {
      abortEffect(effect);
      handleEffectError(effect, error);
    }
  }

  function handleEffectError(effect: Effect, error: unknown): void {
    const owner = effect.owner as F;

    const boundary = findErrorBoundary(owner);
    if (boundary !== null) {
      captureCommittedErrorBoundary(boundary, error, owner);
      scheduleFiber(boundary, DefaultLane);
      return;
    }

    rootOf(owner).uncaughtErrorInfo = errorInfoFor(owner, error);
    throw error;
  }

  function abortFiberEffects(node: F): void {
    visitFiberHooks(node, (_owner, hook) => {
      if (isEffectHook(hook.kind)) abortEffect(hook.memoizedState as Effect);
      if (isExternalStoreHook(hook))
        unsubscribeExternalStore(hook.memoizedState);
      if (isReactiveEventHook(hook)) {
        const instance = hook.memoizedState.instance;
        instance.controller?.abort();
        instance.controller = null;
        // Calls after unmount (or while hidden) still run the last committed
        // handler, but with a signal that is already aborted.
        instance.live = false;
      }
    });
  }

  function abortEffect(effect: Effect): void {
    effect.controller?.abort();
    effect.controller = null;
  }

  function unsubscribeExternalStore(
    state: ExternalStoreState<unknown, F>,
  ): void {
    state.instance.unsubscribe?.();
    state.instance.unsubscribe = null;
    state.instance.committedSubscribe = null;
    state.instance.owner = null;
  }

  function restoreConsumedPendingQueues(root: R, from = 0): void {
    for (const { queue, pending } of root.consumedPendingQueues.splice(from)) {
      queue.pending =
        queue.pending === null ? pending : mergeQueues(pending, queue.pending);
    }
  }
}

function activityHidden(props: Props): boolean {
  return props.mode === "hidden";
}

function isEffectHook(kind: FigDevtoolsHookKind): boolean {
  return (
    kind === "reactive" || kind === "before-paint" || kind === "before-layout"
  );
}

function createHook<S>(kind: FigDevtoolsHookKind, state: S): Hook<S> {
  return {
    kind,
    memoizedState: state,
    baseState: state,
    baseQueue: null,
    queue: { pending: null, dispatch: null },
    next: null,
  };
}

function createActionState<S, Args extends unknown[]>(
  action: ActionStateAction<S, Args>,
  value: S,
): ActionState<S, Args> {
  return {
    action,
    error: NoActionStateError,
    instance: { action, value },
    pending: 0,
    value,
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
  if (isResources(element.type)) return ResourcesTag;
  if (isContext(element.type)) return ContextProviderTag;
  if (isSuspense(element.type)) return SuspenseTag;
  if (isActivity(element.type)) return ActivityTag;
  if (isErrorBoundary(element.type)) return ErrorBoundaryTag;
  return FunctionTag;
}

// --- Fast Refresh (HMR) ----------------------------------------------------
// A family groups every version of a component across hot edits; `current` is
// the latest implementation. The handler is module-global (one refresh runtime
// per app) so module-level reconcile helpers can consult it. In production no
// handler is ever set, so all of this collapses to the identity/equality paths.

export interface RefreshFamily {
  current: unknown;
}

export interface RefreshUpdate {
  staleFamilies: Set<RefreshFamily>;
  updatedFamilies: Set<RefreshFamily>;
}

let resolveFamily: ((type: unknown) => RefreshFamily | undefined) | null = null;
let staleFamilies: Set<RefreshFamily> | null = null;

export function setRefreshHandler(
  handler: ((type: unknown) => RefreshFamily | undefined) | null,
): void {
  resolveFamily = handler;
}

function resolveLatestType(type: unknown): unknown {
  if (resolveFamily === null) return type;
  const family = resolveFamily(type);
  return family === undefined ? type : family.current;
}

// Whether an existing fiber can be reused for the next element's type (reuse =
// preserve hook state). Without a refresh handler this is plain reference
// equality. For a tracked component, two types match when they share a family —
// but a family marked stale this refresh pass (its hook signature changed) never
// matches, forcing a remount even when the type reference is unchanged.
function matchesComponentFamily(
  fiberType: unknown,
  childType: unknown,
): boolean {
  if (resolveFamily === null) return fiberType === childType;
  const family = resolveFamily(fiberType);
  if (family === undefined) return fiberType === childType;
  if (family !== resolveFamily(childType)) return false;
  return staleFamilies === null || !staleFamilies.has(family);
}

function sameType<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
  child: FigChild,
): boolean {
  if (typeof child === "string" || typeof child === "number") {
    return fiber.tag === TextTag;
  }

  if (isPortal(child)) {
    return fiber.tag === PortalTag && fiber.props.target === child.target;
  }

  return (
    isValidElement(child) && matchesComponentFamily(fiber.type, child.type)
  );
}

function propsFor(child: FigChild): Props {
  if (typeof child === "string" || typeof child === "number") {
    return { nodeValue: String(child) };
  }

  if (isPortal(child)) return portalProps(child);
  if (isValidElement(child)) return child.props;

  throw invalidChildError(child);
}

function portalProps(child: FigPortal): Props {
  return { children: child.children, target: child.target };
}

function childKey(
  child: FigChild,
  index: number,
  seenKeys: Set<string>,
): string {
  if ((!isValidElement(child) && !isPortal(child)) || child.key === null) {
    return implicitKey(index);
  }

  const key = explicitKey(child.key);
  if (process.env.NODE_ENV !== "production" && seenKeys.has(key)) {
    throw duplicateKeyError(child.key);
  }
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

function collectChildren(node: FigNode): FigChild[] {
  const children: FigChild[] = [];
  collectChild(node, children);
  return children;
}

function collectChild(node: FigNode, children: FigChild[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectChild(child as FigNode, children);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") return;

  if (typeof node === "string" || typeof node === "number") {
    appendTextChild(children, String(node));
    return;
  }

  if (isValidElement(node) || isPortal(node)) {
    children.push(node);
    return;
  }

  throw invalidChildError(node);
}

function appendTextChild(children: FigChild[], text: string): void {
  const previous = children.at(-1);

  if (typeof previous === "string" || typeof previous === "number") {
    children[children.length - 1] = `${previous}${text}`;
  } else {
    children.push(text);
  }
}

const EmptyHostTextContent = Symbol("fig.empty-host-text-content");
const NonTextHostContent = Symbol("fig.non-text-host-content");

type HostTextContent =
  | string
  | typeof EmptyHostTextContent
  | typeof NonTextHostContent;

function hostTextContent(children: unknown): string | null {
  const text = hostTextContentPart(children as FigNode);
  return typeof text === "string" ? text : null;
}

function validateHostContentProps(props: Props): void {
  if (!hasRenderableChild(props.children as FigNode)) return;

  throw new Error("Host elements cannot have both unsafeHTML and children.");
}

function hostChildren(props: Props): FigNode {
  if (!hasUnsafeHTML(props)) return props.children as FigNode;
  validateHostContentProps(props);
  return null;
}

function hasUnsafeHTML(props: Props): boolean {
  return !emptyValue(props.unsafeHTML);
}

function hasRenderableChild(node: FigNode): boolean {
  if (Array.isArray(node)) return node.some(hasRenderableChild);
  return !emptyChild(node);
}

function emptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === false;
}

function emptyChild(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "boolean";
}

function hostTextContentPart(node: FigNode): HostTextContent {
  if (Array.isArray(node)) {
    let hasText = false;
    let text = "";

    for (const child of node) {
      const childText = hostTextContentPart(child as FigNode);
      if (childText === NonTextHostContent) return NonTextHostContent;
      if (childText === EmptyHostTextContent) continue;

      hasText = true;
      text += childText;
    }

    return hasText ? text : EmptyHostTextContent;
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return EmptyHostTextContent;
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (isValidElement(node) || isPortal(node)) return NonTextHostContent;

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

// Retries of a committed fallback render at retry-lane priority rather than
// the lane of the update that originally suspended. A boundary that suspends
// again while retrying keeps its existing retry lane so successive retries of
// one boundary stay grouped instead of claiming a new lane per ping.
function suspenseRetryLane(lanes: Lanes): Lane {
  const retryLanes = lanes & RetryLanes;
  return retryLanes === NoLanes
    ? claimNextRetryLane()
    : getHighestPriorityLane(retryLanes);
}

const devtoolsFiberIds = new WeakMap<object, number>();
const devtoolsRootIds = new WeakMap<object, number>();
const devtoolsRendererIds = new WeakMap<object, number>();
let nextDevtoolsFiberId = 1;
let nextDevtoolsRootId = 1;

interface DevtoolsInspectionState {
  hostFibers: WeakMap<object, number>;
}

function emitDevtoolsCommit<Container, Instance, TextInstance>(
  renderer: object,
  root: FiberRoot<Container, Instance, TextInstance>,
): void {
  const hook = getFigDevtoolsGlobalHook();
  if (hook === null) return;

  try {
    let rendererId = devtoolsRendererIds.get(renderer);
    if (rendererId === undefined) {
      rendererId = hook.inject({
        name: "Fig",
        packageName: "@bgub/fig-reconciler",
      });
      devtoolsRendererIds.set(renderer, rendererId);
    }

    const inspection = createDevtoolsInspectionState();
    const snapshot = snapshotDevtoolsRoot(root, rendererId, inspection);
    hook.onCommitRoot(
      rendererId,
      snapshot,
      createDevtoolsCommitInspection(snapshot.id, inspection),
    );
  } catch {
    // DevTools should never affect application rendering.
  }
}

function snapshotDevtoolsRoot<Container, Instance, TextInstance>(
  root: FiberRoot<Container, Instance, TextInstance>,
  rendererId: number,
  inspection: DevtoolsInspectionState,
): FigDevtoolsRootSnapshot {
  return {
    id: devtoolsRootId(root),
    rendererId,
    committedAt: now(),
    dataResources: root.dataStore.inspectDataEntries(),
    pendingLanes: root.pendingLanes,
    suspendedLanes: root.suspendedLanes,
    pingedLanes: root.pingedLanes,
    expiredLanes: root.expiredLanes,
    tree: snapshotDevtoolsFiber(root.current, null, inspection),
  };
}

function snapshotDevtoolsFiber<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
  parentId: number | null,
  inspection: DevtoolsInspectionState,
): FigDevtoolsFiberSnapshot {
  const id = devtoolsFiberId(node);
  const { kind, name } = devtoolsFiberInfo(node);
  const children: FigDevtoolsFiberSnapshot[] = [];
  recordDevtoolsHostFiber(node, id, inspection);

  for (let child = node.child; child !== null; child = child.sibling) {
    children.push(snapshotDevtoolsFiber(child, id, inspection));
  }

  return {
    id,
    parentId,
    name,
    kind,
    key: node.key,
    index: node.index,
    props: devtoolsProps(node),
    lanes: node.lanes,
    childLanes: node.childLanes,
    hooks: devtoolsHooks(node.memoizedState),
    contextDependencies: devtoolsContextDependencies(node),
    host: devtoolsHost(node),
    capturedError: node.errorBoundaryState?.error,
    componentStack: node.errorBoundaryState?.info.componentStack,
    children,
  };
}

function devtoolsRootId(root: object): number {
  const existing = devtoolsRootIds.get(root);
  if (existing !== undefined) return existing;

  const id = nextDevtoolsRootId;
  nextDevtoolsRootId += 1;
  devtoolsRootIds.set(root, id);
  return id;
}

function createDevtoolsInspectionState(): DevtoolsInspectionState {
  return { hostFibers: new WeakMap() };
}

function createDevtoolsCommitInspection(
  rootId: number,
  inspection: DevtoolsInspectionState,
): FigDevtoolsCommitInspection {
  return {
    inspectElement(target) {
      if (typeof target !== "object" || target === null) return null;

      const fiberId = inspection.hostFibers.get(target);
      return fiberId === undefined ? null : { rootId, fiberId };
    },
  };
}

function recordDevtoolsHostFiber<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
  id: number,
  inspection: DevtoolsInspectionState,
): void {
  if (node.tag !== HostTag && node.tag !== TextTag) return;
  if (typeof node.stateNode !== "object" || node.stateNode === null) return;
  inspection.hostFibers.set(node.stateNode, id);
}

function devtoolsFiberId<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
): number {
  const existing =
    devtoolsFiberIds.get(node) ??
    (node.alternate === null
      ? undefined
      : devtoolsFiberIds.get(node.alternate));

  if (existing !== undefined) {
    devtoolsFiberIds.set(node, existing);
    if (node.alternate !== null) devtoolsFiberIds.set(node.alternate, existing);
    return existing;
  }

  const id = nextDevtoolsFiberId;
  nextDevtoolsFiberId += 1;
  devtoolsFiberIds.set(node, id);
  if (node.alternate !== null) devtoolsFiberIds.set(node.alternate, id);
  return id;
}

function devtoolsProps<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
): Props {
  const props: Props = {};
  const source = node.memoizedProps ?? node.props;

  for (const [key, value] of Object.entries(source)) {
    if (key !== "children") props[key] = value;
  }

  return props;
}

function devtoolsHooks(firstHook: Hook | null): FigDevtoolsHookSnapshot[] {
  const hooks: FigDevtoolsHookSnapshot[] = [];
  let id = 0;

  for (
    let hook: Hook<any> | null = firstHook;
    hook !== null;
    hook = hook.next
  ) {
    id += 1;

    if (isEffectHook(hook.kind)) {
      const effect = hook.memoizedState as Effect;
      hooks.push({
        id,
        kind: hook.kind,
        deps: effect.deps,
        phase: devtoolsEffectPhase(effect.phase),
        active: effect.controller !== null,
      });
    } else if (hook.kind === "memo") {
      const memo = hook.memoizedState as MemoState<unknown>;
      hooks.push({
        id,
        kind: hook.kind,
        state: memo.value,
        deps: memo.deps,
      });
    } else if (hook.kind === "external-store") {
      const store = hook.memoizedState as ExternalStoreState<unknown, unknown>;
      hooks.push({
        id,
        kind: hook.kind,
        state: store.value,
      });
    } else {
      const stateHook = hook as Hook<unknown>;
      hooks.push({
        id,
        kind: stateHook.kind,
        state: stateHook.memoizedState,
      });
    }
  }

  return hooks;
}

function devtoolsContextDependencies<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
): string[] {
  return (
    node.contextDependencies?.map((context) =>
      devtoolsTypeName(context, "Context"),
    ) ?? []
  );
}

function devtoolsHost<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
): FigDevtoolsHostSnapshot | undefined {
  if (node.tag === TextTag) {
    const text = node.stateNode as { nodeValue?: unknown } | null;
    const value =
      typeof text?.nodeValue === "string"
        ? text.nodeValue
        : typeof node.memoizedProps?.nodeValue === "string"
          ? node.memoizedProps.nodeValue
          : undefined;

    return {
      kind: "text",
      text: value === undefined ? undefined : devtoolsTruncate(value),
    };
  }

  if (node.tag !== HostTag) return undefined;

  const instance = node.stateNode as {
    getAttribute?(name: string): string | null;
    getAttributeNames?(): string[];
    localName?: unknown;
    tagName?: unknown;
  } | null;
  const attributes: Record<string, string> = {};
  const getAttribute = instance?.getAttribute?.bind(instance);

  for (const name of instance?.getAttributeNames?.() ?? []) {
    const value = getAttribute?.(name);
    attributes[name] = value === null || value === undefined ? "" : value;
  }

  return {
    kind: "element",
    tagName:
      typeof instance?.localName === "string"
        ? instance.localName
        : typeof instance?.tagName === "string"
          ? instance.tagName.toLowerCase()
          : String(node.type),
    attributes,
  };
}

function devtoolsFiberInfo<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
): {
  kind: FigDevtoolsFiberKind;
  name: string;
} {
  switch (node.tag) {
    case RootTag:
      return { kind: "root", name: "Root" };
    case HostTag:
      return { kind: "host", name: String(node.type) };
    case TextTag:
      return { kind: "text", name: "#text" };
    case FunctionTag:
      return {
        kind: "function",
        name: devtoolsTypeName(node.type, "Anonymous"),
      };
    case FragmentTag:
      return { kind: "fragment", name: "Fragment" };
    case ContextProviderTag:
      return {
        kind: "context-provider",
        name: `${devtoolsTypeName(node.type, "Context")}.Provider`,
      };
    case SuspenseTag:
      return { kind: "suspense", name: "Suspense" };
    case ErrorBoundaryTag:
      return { kind: "error-boundary", name: "ErrorBoundary" };
    case ActivityTag:
      return { kind: "activity", name: "Activity" };
    case PortalTag:
      return { kind: "portal", name: "Portal" };
    case ResourcesTag:
      return { kind: "resources", name: "Resources" };
  }
}

function devtoolsEffectPhase(phase: EffectPhase): FigDevtoolsEffectPhase {
  if (phase === BeforePaintEffect) return "before-paint";
  if (phase === BeforeLayoutEffect) return "before-layout";
  return "reactive";
}

function devtoolsTruncate(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
