import {
  type ActionStateAction,
  type ActionStateRunner,
  type AwaitedFigNode,
  type DataResource,
  type DataResourceKeyInput,
  type DependencyList,
  type EffectCallback,
  type ElementType,
  type ErrorBoundaryProps,
  type ErrorInfo,
  type ExternalStoreSubscribe,
  type FigAssetResourceList,
  type FigContext,
  type FigDataHydrationEntry,
  type FigDataStoreController,
  type FigDataStoreHandle,
  type FigNode,
  type FigPortal,
  isValidElement,
  type Props,
  type StartTransition,
  type StateSetter,
  type TransitionOptions,
  type ViewTransitionProps,
} from "@bgub/fig";
import {
  collectChildren,
  attachDataStore,
  dataResourceKeysForError,
  type FigDataStore,
  invalidChildError,
  isPortal,
  isThenable,
  type StableEventCallerArgs,
  type NormalizedChild,
  type RenderDispatcher,
  readThenable,
  setCurrentDataStore,
  setCurrentDispatcher,
  setTransitionHandler,
  trackThenable,
  type Thenable,
} from "@bgub/fig/internal";
import {
  clearCommitIndex,
  type CommitIndex,
  recordCommitWork,
  rollbackCommitIndex,
} from "./commit-index.ts";
import { emitDevtoolsCommit } from "./devtools-snapshot.ts";
import { devtoolsTypeName } from "./devtools-internal.ts";
import type {
  ReconcilerCommitContext,
  ReconcilerCommitCoordinator,
  ReconcilerWorkPriority,
} from "./commit-coordinator.ts";
import type {
  ViewTransitionPlannerFiber,
  ViewTransitionPlannerRoot,
  ViewTransitionPlannerState,
} from "./view-transition-planner-types.ts";
import {
  ActivityTag,
  AssetsTag,
  ContextProviderTag,
  ErrorBoundaryTag,
  FragmentTag,
  FunctionTag,
  HostTag,
  PortalTag,
  RootTag,
  SuspenseTag,
  tagFor,
  type Tag,
  TextTag,
  ThenableTag,
  ViewTransitionTag,
} from "./fiber-tags.ts";
import { walkFiberForest, walkFiberSubtree } from "./fiber-traversal.ts";
import {
  AssetFlag,
  AdoptedFlag,
  AssembledFlag,
  childSubtreeFlags,
  clearTransientFlags,
  ContextPropagationFlag,
  DeletionFlag,
  EffectFlag,
  HoistedStaticFlag,
  type Flag,
  HostUpdateMask,
  HydrationFlag,
  MutationMask,
  NoFlags,
  PlacementFlag,
  StaticFlagsMask,
  StoreConsistencyFlag,
  TextContentFlag,
  UpdateFlag,
  ViewTransitionStaticFlag,
  VisibilityFlag,
} from "./fiber-work.ts";
import {
  ActionStateHook,
  BeforeLayoutEffect,
  BeforePaintEffect,
  DeferredValueHook,
  type EffectPhase,
  ExternalStoreHook,
  hookKindNames,
  type HookKind,
  IdHook,
  isEffectHook,
  MemoHook,
  ReactiveEffect,
  StableEventHook,
  StateHook,
  TransitionHook,
} from "./hook-kinds.ts";
import {
  clearQueueLanes,
  cloneQueue,
  cloneQueueNodes,
  cloneUpdateNode,
  type HookQueue,
  HookUpdate,
  mergeQueues,
  type StateUpdate,
} from "./hook-queue.ts";
import {
  hasUnsafeHTML,
  hostChildren,
  hostTextContent,
} from "./host-content.ts";
import {
  AllTransitionLanes,
  claimNextRetryLane,
  claimNextTransitionLane,
  createLaneMap,
  DefaultHydrationLane,
  DefaultLane,
  DeferredLane,
  getHighestPriorityLane,
  getLaneSchedulerPriority,
  getNextLanes,
  IdleLane,
  InputContinuousLane,
  includesOnlyTransitions,
  includesSomeLane,
  isSyncLane,
  type Lane,
  type LaneRoot,
  type Lanes,
  markRootEntangled,
  markRootFinished,
  markRootPinged,
  markRootSuspended,
  markRootUpdated,
  markStarvedLanesAsExpired,
  mergeLanes,
  NoLane,
  NoLanes,
  NoTimestamp,
  OffscreenLane,
  RetryLanes,
  requestUpdateLane,
  runWithPriority,
  runWithTransition,
  runWithTransitionLane,
  transitionTypeHooks,
  SelectiveHydrationLane,
  SyncLane,
} from "./lanes.ts";
import {
  hasRefreshHandler,
  matchesComponentFamily,
  refreshFamilyFor,
  resolveLatestType,
  runWithStaleRefreshFamilies,
} from "./refresh-internal.ts";
import type { RefreshUpdate } from "./refresh.ts";
export type { RefreshUpdate } from "./refresh.ts";
import { createRootDataStore } from "./root-data-store.ts";
import {
  NormalPriority,
  now,
  requestPaint,
  type ScheduledTask,
  scheduleCallback,
  shouldYieldToHost,
} from "./scheduler.ts";

export type EventPriority = "default" | "continuous" | "discrete";

export function runWithEventPriority<T>(
  priority: EventPriority,
  callback: () => T,
): T {
  return runWithPriority(eventPriorityLane(priority), callback);
}

function eventPriorityLane(priority: EventPriority): Lane {
  switch (priority) {
    case "discrete":
      return SyncLane;
    case "continuous":
      return InputContinuousLane;
    case "default":
      return DefaultLane;
  }
}

function hydrationLaneForPriority(priority: EventPriority): Lane {
  return priority === "discrete" ? SyncLane : SelectiveHydrationLane;
}

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

setTransitionHandler(runWithTransition);

type Component = (props: Props & { children?: FigNode }) => FigNode;
type HostNode<Instance, TextInstance> = Instance | TextInstance;
type Parent<Container, Instance> = Container | Instance;
type FiberType = ElementType | FigContext<unknown> | null;

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

declare const AssetResourceOwnerBrand: unique symbol;

/** Stable opaque identity for one fiber's asset-resource ownership. */
export interface AssetResourceOwner {
  readonly [AssetResourceOwnerBrand]: true;
}

export interface HostConfig<Container, Instance, TextInstance> {
  createInstance(
    type: string,
    props: Props,
    parent: Parent<Container, Instance>,
  ): Instance;
  createTextInstance(text: string): TextInstance;
  validateInstanceNesting?(
    type: string,
    props: Props,
    ancestors: readonly string[],
  ): void;
  validateTextNesting?(text: string, ancestors: readonly string[]): void;
  containerType?(container: Parent<Container, Instance>): string | null;
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
    suppressHydrationWarning?: boolean,
  ): boolean;
  // True when unmatched DOM siblings at the end of this hydrated host belong
  // to an out-of-band owner and must remain outside the reconciled tree.
  canRetainHydrationTail?(instance: Instance): boolean;
  // Resolve an out-of-band host instance using the real host parent. Returning
  // an instance fixes the fiber's placement as hoisted for its lifetime: it
  // does not consume a hydration cursor node and commit acquires/releases it
  // through the hooks below instead of insertBefore/removeChild. Returning
  // null leaves the fiber on the ordinary hydrate/create path.
  resolveHoistedInstance?(
    type: string,
    props: Props,
    parent: Parent<Container, Instance>,
  ): Instance | null;
  // May return a different instance when the fiber's identity already
  // resolves to a live shared instance (e.g. one inserted while this render
  // was suspended); the fiber adopts the returned instance.
  commitHoistedInstance?(
    instance: Instance,
    props: Props,
    owner: AssetResourceOwner,
  ): Instance | void;
  removeHoistedInstance?(instance: Instance, owner: AssetResourceOwner): void;
  // Hoisted instances are shared by identity (key), so an update that
  // changes the identity must not mutate the shared instance in place; the
  // host releases the old identity and returns the instance to use, which
  // may differ from the current one.
  updateHoistedInstance?(
    instance: Instance,
    previousProps: Props,
    nextProps: Props,
    owner: AssetResourceOwner,
  ): Instance;
  // Assets fibers are transparent to host placement. This commit-time diff is
  // their complete lifecycle: null means the owner did not exist on that side
  // of the commit. The host owns normalization, dedupe, and reference counts.
  commitAssetResources?(
    previous: FigAssetResourceList | null,
    next: FigAssetResourceList | null,
    owner: AssetResourceOwner,
  ): void;
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
  getEnclosingSuspenseBoundaryStart?(
    target: unknown,
  ): HostNode<Instance, TextInstance> | null;
  isTargetWithinSuspenseBoundary?(
    target: unknown,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): boolean;
  shouldRecoverSuspenseMismatchAtRoot?(
    container: Container,
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): boolean;
  registerSuspenseBoundaryRetry?(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
    retry: () => void,
  ): void;
  commitHydratedSuspenseBoundary?(
    boundary: DehydratedSuspenseBoundary<Instance, TextInstance>,
  ): void;
  completeRootHydration?(container: Container): void;
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

// Capability types describe coherent host method groups for renderers that
// implement them. Plain regroupings of HostConfig members do not earn aliases.
export type HostHydrationConfig<Container, Instance, TextInstance> = Required<
  Pick<
    HostConfig<Container, Instance, TextInstance>,
    | "getFirstHydratableChild"
    | "getNextHydratableSibling"
    | "canHydrateInstance"
    | "canHydrateTextInstance"
    | "clearContainer"
  >
> &
  Pick<HostConfig<Container, Instance, TextInstance>, "commitHydratedInstance">;

export type HostActivityConfig<Container, Instance, TextInstance> = Required<
  Pick<
    HostConfig<Container, Instance, TextInstance>,
    | "getActivityBoundary"
    | "getFirstActivityHydratable"
    | "commitHydratedActivityBoundary"
    | "hideInstance"
    | "unhideInstance"
    | "hideTextInstance"
    | "unhideTextInstance"
  >
>;

export type HostSuspenseHydrationConfig<Container, Instance, TextInstance> =
  Required<
    Pick<
      HostConfig<Container, Instance, TextInstance>,
      | "getSuspenseBoundary"
      | "getEnclosingSuspenseBoundaryStart"
      | "isTargetWithinSuspenseBoundary"
      | "registerSuspenseBoundaryRetry"
      | "commitHydratedSuspenseBoundary"
      | "completeRootHydration"
      | "removeDehydratedSuspenseBoundary"
    >
  >;

export type HostPortalConfig<Container, Instance, TextInstance> = Required<
  Pick<
    HostConfig<Container, Instance, TextInstance>,
    "preparePortalContainer" | "removePortalContainer"
  >
>;

export type HostHoistedAssetConfig<Container, Instance, TextInstance> =
  Required<
    Pick<
      HostConfig<Container, Instance, TextInstance>,
      | "resolveHoistedInstance"
      | "commitHoistedInstance"
      | "removeHoistedInstance"
      | "updateHoistedInstance"
    >
  >;

export interface FigRoot {
  data: FigDataStoreHandle;
  render(children: FigNode): void;
  unmount(): void;
}

export interface FigRootOptions {
  /** Adopt a store populated before the renderer root was created. */
  dataStore?: FigDataStoreController;
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
  componentStack: string;
  digest?: string;
  expected?: string;
  recovery: "root" | "suspense";
  source: "hydration" | "server";
}

export type HydrationTargetResult = "none" | "hydrated" | "blocked";

export interface FigRenderer<Container, Instance = unknown> {
  batchedUpdates<T>(this: void, callback: () => T): T;
  createRoot(
    this: void,
    container: Container,
    options?: FigRootOptions,
  ): FigRoot;
  hydrateRoot(
    this: void,
    container: Container,
    children: FigNode,
    options?: FigRootOptions,
  ): FigRoot;
  hydrateTarget(
    this: void,
    container: Container,
    target: unknown,
    priority?: EventPriority,
  ): HydrationTargetResult;
  flushSync<T>(this: void, callback: () => T): T;
  installCommitCoordinator(
    this: void,
    coordinator: ReconcilerCommitCoordinator<Container, Instance>,
  ): void;
  scheduleRefresh(this: void, update: RefreshUpdate): void;
}

interface Hook<S = any> {
  kind: HookKind;
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

type StableEventHandler = (...args: unknown[]) => unknown;

interface StableEventInstance {
  controller: AbortController | null;
  handler: StableEventHandler | null;
  live: boolean;
  stable: StableEventHandler;
}

interface StableEventState {
  instance: StableEventInstance;
  // Lives on the per-render hook state, not the persistent instance: commits
  // republish bailed-out fibers' hooks, so an abandoned render's handler must
  // never be reachable from the instance.
  next: StableEventHandler;
}

interface MemoState<T> {
  value: T;
  deps: DependencyList;
}

// One cancellable run per hook: supersede/unmount/hide abort the controller
// and bump the generation, which retires the run — retired settlements are
// fully inert (no pending decrement, rejections swallowed).
interface RunInstance {
  controller: AbortController | null;
  generation: number;
}

interface TransitionState {
  instance: RunInstance;
  pendingCount: number;
  start: StartTransition | null;
}

const NoActionStateError = Symbol();

interface ActionStateInstance<S, Args extends unknown[]> extends RunInstance {
  action: ActionStateAction<S, Args>;
  runner: ActionStateRunner<Args> | null;
  value: S;
}

interface ActionState<S, Args extends unknown[]> {
  error: unknown;
  instance: ActionStateInstance<S, Args>;
  pending: number;
  action: ActionStateAction<S, Args>;
  value: S;
}

type QueuedHookKind =
  | typeof StateHook
  | typeof TransitionHook
  | typeof ActionStateHook;

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
  // Canonical server-tree position captured when the marker is first claimed.
  // Hydration restores this base even if updates insert or move siblings before
  // the boundary resumes.
  idPath: string;
  wasPending: boolean;
}

type SuspenseState<Container, Instance, TextInstance> =
  | SuspenseFallbackState<Container, Instance, TextInstance>
  | DehydratedSuspenseState<Instance, TextInstance>;

interface HiddenState<Container, Instance, TextInstance> {
  currentFirstChild: Fiber<Container, Instance, TextInstance> | null;
}

interface ErrorBoundaryState {
  error: unknown;
  info: ErrorInfo;
  didReport: boolean;
}

interface DehydratedActivityState<Instance> {
  // The host boundary (an inert template holding server content) while the
  // Activity is dehydrated. Cleared when the content unpacks at commit.
  boundary: Instance;
  // Same snapshot as dehydrated Suspense, for hidden server content that may
  // hydrate after the surrounding client tree has changed.
  idPath: string;
}

interface ActivityState<Instance> {
  hidden: boolean;
  dehydrated: DehydratedActivityState<Instance> | null;
}

type BoundaryState<Container, Instance, TextInstance> =
  | SuspenseState<Container, Instance, TextInstance>
  | ErrorBoundaryState
  | ActivityState<Instance>;

interface ContextDependency {
  context: FigContext<unknown>;
  memoizedValue: unknown;
}

// A suspension recorded during render, retried through the boundary fiber
// once a commit blesses that fiber's identity. Entries from discarded renders
// die with the render; their thenables are covered by the root ping attached
// at capture time.
interface PendingSuspenseRetry<Container, Instance, TextInstance> {
  boundary: Fiber<Container, Instance, TextInstance>;
  thenable: Thenable;
  lanes: Lanes;
}

interface Fiber<
  Container,
  Instance,
  TextInstance,
> extends ViewTransitionPlannerFiber {
  tag: Tag;
  type: FiberType;
  key: string | number | null;
  props: Props;
  memoizedProps: Props | null;
  committedProps: Props | null;
  memoizedState: Hook<any> | null;
  stateNode:
    | HostNode<Instance, TextInstance>
    | FiberRoot<Container, Instance, TextInstance>
    | ViewTransitionState
    | null;
  return: Fiber<Container, Instance, TextInstance> | null;
  child: Fiber<Container, Instance, TextInstance> | null;
  sibling: Fiber<Container, Instance, TextInstance> | null;
  index: number;
  alternate: Fiber<Container, Instance, TextInstance> | null;
  flags: Flag;
  subtreeFlags: Flag;
  deletions: Fiber<Container, Instance, TextInstance>[] | null;
  lanes: Lanes;
  childLanes: Lanes;
  effects: Effect[] | null;
  contextDependencies: ContextDependency[] | null;
  contextSubtreeDependencies: FigContext<unknown>[] | null;
  dataDependenciesDirty: boolean;
  // Lazily allocated only for hoisted hosts and Assets fibers. Keep cold
  // lifecycle state after the topology and work fields.
  assetResourceOwner: AssetResourceOwner | null;
  // The fiber tag discriminates this union.
  // Activity state is shared by both generations so stale return chains see
  // the committed visibility state.
  boundaryState: BoundaryState<Container, Instance, TextInstance> | null;
  suspenseQueueStart?: number;
  // Suspense/ErrorBoundary only: root commit-index length when this boundary
  // began, so a capture can truncate entries queued by its discarded subtree.
  commitIndexCheckpoint?: number;
  hiddenState: HiddenState<Container, Instance, TextInstance> | null;
}

interface ViewTransitionState extends ViewTransitionPlannerState {
  autoName: string | null;
}

interface FiberRoot<Container, Instance, TextInstance>
  extends LaneRoot, ViewTransitionPlannerRoot<Container> {
  container: Container;
  current: Fiber<Container, Instance, TextInstance>;
  element: FigNode;
  identifierPrefix: string;
  nextClientId: number;
  devtools: boolean;
  callback: ScheduledTask | null;
  callbackPriority: Lane;
  wip: Fiber<Container, Instance, TextInstance> | null;
  finishedWork: Fiber<Container, Instance, TextInstance> | null;
  renderLanes: Lanes;
  pendingCoordinatedCommit: boolean;
  // finishedWork is rendered but its commit waits for a coordinator-owned
  // operation to finish. Unlike pendingCoordinatedCommit (the sub-frame
  // commit window, which freezes the root), a parked root keeps rendering:
  // newer work supersedes the parked tree so the latest state commits when
  // the animation ends.
  parkedCoordinatedCommit: boolean;
  dataStore: FigDataStore;
  contextValues: Map<FigContext<unknown>, unknown>;
  contextStack: ContextStackEntry<Container, Instance, TextInstance>[];
  externalStores: Set<
    ExternalStoreInstance<unknown, Fiber<Container, Instance, TextInstance>>
  >;
  pendingReactiveEffects: Effect[];
  reactiveCallback: ScheduledTask | null;
  suspendedThenables: WeakMap<object, Lanes>;
  pendingSuspenseRetries: PendingSuspenseRetry<
    Container,
    Instance,
    TextInstance
  >[];
  attachedSuspenseRetries: WeakMap<
    object,
    WeakSet<Fiber<Container, Instance, TextInstance>>
  >;
  consumedPendingQueues: ConsumedPendingQueue[];
  onRecoverableError: (error: unknown, info: RecoverableErrorInfo) => void;
  onUncaughtError: ((error: unknown, info: ErrorInfo) => void) | null;
  recoverableErrors: RecoverableErrorRecord[];
  uncaughtErrorInfo: ErrorInfo | null;
  commitEffectPhases: number;
  needsCommitDeletions: boolean;
  // Commit work discovered during render: every fiber that rendered hooks,
  // recorded deletions, or caught an error, in begin order (pre-order over
  // the rendered region). Commit passes iterate this instead of walking the
  // tree; each pass re-checks its own per-fiber predicate, so duplicate and
  // stale entries are inert. Truncated to a boundary checkpoint when a
  // capture discards its subtree; cleared on restart and after commit.
  commitIndex: CommitIndex<Fiber<Container, Instance, TextInstance>>;
  // Boundaries that caught during the commit phase (effects, reactive
  // flushes). Kept outside the commit index: these must survive render restarts
  // until a later commit reports them.
  committedCaughtErrors: Fiber<Container, Instance, TextInstance>[];
  isHydrating: boolean;
  isHydrationRoot: boolean;
  hydrationParent: Fiber<Container, Instance, TextInstance> | null;
  hydratingSuspenseBoundary: Fiber<Container, Instance, TextInstance> | null;
  hydratingActivityBoundary: Fiber<Container, Instance, TextInstance> | null;
  dehydratedSuspenseCount: number;
  // Live dehydrated boundaries keyed by their start marker node, rebuilt in
  // the same post-commit walk that maintains dehydratedSuspenseCount, so
  // event-target lookups resolve to a fiber without searching the tree.
  dehydratedBoundaries: Map<
    HostNode<Instance, TextInstance>,
    Fiber<Container, Instance, TextInstance>
  >;
  needsRootHydrationCompletion: boolean;
  nextHydratableInstance: HostNode<Instance, TextInstance> | null;
  clearContainerBeforeCommit: boolean;
  hydrationInitialElement: FigNode | typeof NoHydrationInitialElement;
}

interface ContextStackEntry<Container, Instance, TextInstance> {
  context: FigContext<unknown>;
  hadPrevious: boolean;
  previous: unknown;
  provider: Fiber<Container, Instance, TextInstance>;
}

interface ConsumedPendingQueue {
  queue: HookQueue<unknown>;
  pending: HookUpdate<unknown>;
}

interface RecoverableErrorRecord {
  error: unknown;
  info: RecoverableErrorInfo;
}

type RecoverableDetails = Omit<RecoverableErrorInfo, "componentStack">;

const PreservedSuspense = Symbol("fig.preserved-suspense");
const NoHydrationInitialElement = Symbol("fig.no-hydration-initial-element");

class HydrationMismatchError extends Error {}

export function createRenderer<Container, Instance, TextInstance>(
  host: HostConfig<Container, Instance, TextInstance>,
): FigRenderer<Container, Instance> {
  type F = Fiber<Container, Instance, TextInstance>;
  type R = FiberRoot<Container, Instance, TextInstance>;
  // Shared read-only stand-in for the common no-retries commit; never pushed
  // to (commits swap in a fresh array before recording anything).
  const noSuspenseRetries: PendingSuspenseRetry<
    Container,
    Instance,
    TextInstance
  >[] = [];
  type ActivityHydrationHostConfig = Required<
    Pick<
      HostConfig<Container, Instance, TextInstance>,
      | "getActivityBoundary"
      | "getFirstActivityHydratable"
      | "commitHydratedActivityBoundary"
    >
  >;
  type ActivityVisibilityHostConfig = Required<
    Pick<
      HostConfig<Container, Instance, TextInstance>,
      | "hideInstance"
      | "unhideInstance"
      | "hideTextInstance"
      | "unhideTextInstance"
    >
  >;
  const roots = new WeakMap<object, R>();
  // Iterable view of live roots, only populated when a refresh handler is set,
  // so a hot-reload pass can walk every mounted tree (dev-only; empty in prod).
  const mountedRoots = new Set<R>();
  const pendingRoots = new Set<R>();
  const batchedRoots = new Set<R>();
  const abandonedHydrationBoundaries = new WeakSet<object>();
  let commitCoordinator: ReconcilerCommitCoordinator<
    Container,
    Instance
  > | null = null;
  let didWarnMissingViewTransitionCoordinator = false;
  let batchDepth = 0;
  let flushingSyncWork = false;
  let commitDepth = 0;
  let needsPostCommitSyncFlush = false;
  let flushingPostCommitSyncWork = false;
  let nestedPostCommitSyncFlushes = 0;
  const nestedPostCommitSyncFlushLimit = 50;
  let currentCommitEffectPhase: EffectPhase | null = null;
  // `hasHiddenBoundaries` gates the parent-walk in `hiddenSubtreeLane`: while it
  // is false no update can need the offscreen downgrade, so the walk is skipped.
  // It is set eagerly true whenever a hidden boundary is begun (covering the
  // in-flight render before its commit) and recomputed from `hiddenStates` at
  // the end of every commit, so it resets to false once the last hidden boundary
  // is revealed or unmounted. `hiddenStates` tracks the live committed
  // `ActivityState`s that are currently hidden; keying on the state object (which
  // both fiber generations share) makes membership generation-agnostic.
  let hasHiddenBoundaries = false;
  const hiddenStates = new Set<ActivityState<Instance>>();
  let activityHostConfig: ActivityVisibilityHostConfig | null = null;
  let activityHydrationHostConfig: ActivityHydrationHostConfig | null = null;
  let hoistedAssetHostConfig: HostHoistedAssetConfig<
    Container,
    Instance,
    TextInstance
  > | null = null;
  let renderingFiber: F | null = null;
  let currentHook: Hook | null = null;
  let workInProgressHook: Hook | null = null;
  let localIdCounter = 0;

  function installCommitCoordinator(
    coordinator: ReconcilerCommitCoordinator<Container, Instance>,
  ): void {
    if (commitCoordinator === coordinator) return;
    if (commitCoordinator !== null) {
      throw new Error(
        `Cannot install commit coordinator "${coordinator.name}": commit ` +
          `coordination is already owned by "${commitCoordinator.name}".`,
      );
    }
    commitCoordinator = coordinator;
  }

  function commitPriority(lanes: Lanes): ReconcilerWorkPriority {
    const lane = getHighestPriorityLane(lanes);
    if (includesSomeLane(RetryLanes | SelectiveHydrationLane, lane)) {
      return "suspense";
    }
    if (includesSomeLane(AllTransitionLanes | DeferredLane, lane)) {
      return "transition";
    }
    if (includesSomeLane(IdleLane | OffscreenLane, lane)) return "idle";
    return "blocking";
  }

  // Argument-identical delegations are direct references (the function
  // declarations below are hoisted); only the effect hooks, which bind their
  // phase constant, need wrappers.
  const dispatcher: RenderDispatcher = {
    useState: updateStateHook,
    useActionState: updateActionStateHook,
    useId: updateIdHook,
    useDeferredValue: updateDeferredValueHook,
    useMemo: updateMemoHook,
    useTransition: updateTransitionHook,
    useReactive(effect: EffectCallback, deps?: DependencyList): void {
      updateEffectHook(ReactiveEffect, effect, deps);
    },
    useBeforePaint(effect: EffectCallback, deps?: DependencyList): void {
      updateEffectHook(BeforePaintEffect, effect, deps);
    },
    useBeforeLayout(effect: EffectCallback, deps?: DependencyList): void {
      updateEffectHook(BeforeLayoutEffect, effect, deps);
    },
    useSyncExternalStore: updateExternalStoreHook,
    useStableEvent: updateStableEventHook,
    readContext: readContextValue,
    readData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      args: TArgs,
    ): TValue {
      const fiber = requireRenderingFiber();
      return rootOf(fiber).dataStore.readData(resource, args, fiber);
    },
    preloadData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      args: TArgs,
    ): void {
      const fiber = requireRenderingFiber();
      rootOf(fiber).dataStore.preloadData(resource, ...args);
    },
    readPromise<T>(promise: PromiseLike<T>): T {
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
      options: FigRootOptions;
    },
  ): R {
    if (roots.has(container as object)) {
      throw duplicateRootError(request.kind);
    }

    if (request.kind === "hydration") requireHydrationHostConfig();

    const root = createFiberRoot(container, request.options);
    roots.set(container as object, root);
    if (__DEV__) {
      if (hasRefreshHandler()) mountedRoots.add(root);
    }

    if (request.kind === "hydration") {
      root.isHydrating = true;
      root.isHydrationRoot = true;
      root.needsRootHydrationCompletion = true;
    }

    return root;
  }

  function createFiberRoot(container: Container, options: FigRootOptions): R {
    const current = fiber(RootTag, null, null, { children: null }, null);
    const dataStoreHost = {
      getLane: requestUpdateLane,
      partition: options.dataPartition,
      schedule(owner: object, lane: unknown): void {
        scheduleFiber(owner as F, hiddenSubtreeLane(owner as F, lane as Lane));
      },
    };
    const dataStore =
      options.dataStore === undefined
        ? createRootDataStore(dataStoreHost)
        : attachDataStore(
            options.dataStore,
            dataStoreHost,
            options.initialData,
          );
    const root: R = {
      container,
      current,
      element: null,
      identifierPrefix: options.identifierPrefix ?? "",
      nextClientId: 0,
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
      pendingCoordinatedCommit: false,
      parkedCoordinatedCommit: false,
      dataStore,
      contextValues: new Map(),
      contextStack: [],
      externalStores: new Set(),
      pendingReactiveEffects: [],
      reactiveCallback: null,
      suspendedThenables: new WeakMap(),
      pendingSuspenseRetries: [],
      attachedSuspenseRetries: new WeakMap(),
      consumedPendingQueues: [],
      onRecoverableError: options.onRecoverableError ?? noop,
      onUncaughtError: options.onUncaughtError ?? null,
      recoverableErrors: [],
      uncaughtErrorInfo: null,
      commitEffectPhases: 0,
      needsCommitDeletions: false,
      commitIndex: [],
      committedCaughtErrors: [],
      isHydrating: false,
      isHydrationRoot: false,
      hydrationParent: null,
      hydratingSuspenseBoundary: null,
      hydratingActivityBoundary: null,
      dehydratedSuspenseCount: 0,
      dehydratedBoundaries: new Map(),
      needsRootHydrationCompletion: false,
      nextHydratableInstance: null,
      clearContainerBeforeCommit: false,
      hydrationInitialElement: NoHydrationInitialElement,
    };
    if (options.dataStore === undefined && options.initialData !== undefined)
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
    let unmounted = false;
    return {
      data: root.dataStore,
      render: (children) => {
        if (unmounted) {
          throw new Error("Cannot update an unmounted root.");
        }
        updateRoot(root, children);
      },
      unmount: () => {
        if (unmounted) return;
        unmounted = true;
        // Tear the tree down synchronously so per-fiber data cleanup runs while
        // the store is still live; dispose is then the final teardown step.
        flushSync(() => updateRoot(root, null));
        root.dataStore.dispose();
        // Free the container so a later createRoot/render starts a fresh root
        // instead of reusing this one's now-disposed store.
        if (roots.get(root.container as object) === root) {
          roots.delete(root.container as object);
        }
        mountedRoots.delete(root);
      },
    };
  }

  function hydrateTarget(
    container: Container,
    target: unknown,
    priority: EventPriority = "default",
  ): HydrationTargetResult {
    const lane = hydrationLaneForPriority(priority);
    const root = roots.get(container as object);
    if (root === undefined) return "none";
    // Before the shell's first hydration commit nothing has handlers, so
    // every target is blocked — reporting "none" here would let a replayed
    // event dispatch into a slot-less tree and be consumed silently. A
    // discrete interaction pulls the whole initial hydration forward
    // synchronously, exactly like it does for a dehydrated boundary.
    if (rootShellPendingHydration(root)) {
      if (isSyncLane(lane)) performRoot(root, true);
      if (rootShellPendingHydration(root)) return "blocked";
    }
    if (root.dehydratedSuspenseCount === 0) return "none";

    const boundary = dehydratedBoundaryForTarget(root, target);
    if (boundary === null) return "none";

    scheduleFiber(boundary, lane);
    if (isSyncLane(lane)) performRoot(root, true);
    return dehydratedBoundaryForTarget(root, target) === null
      ? "hydrated"
      : "blocked";
  }

  // needsRootHydrationCompletion clears when every boundary hydrated, and
  // current.child fills at the first commit — together they mean "the shell
  // has not committed yet" (a root rendering null clears the flag at its
  // first commit, so the conjunction still breaks).
  function rootShellPendingHydration(root: R): boolean {
    return root.needsRootHydrationCompletion && root.current.child === null;
  }

  function dehydratedBoundaryForTarget(root: R, target: unknown): F | null {
    if (host.getEnclosingSuspenseBoundaryStart === undefined) {
      // Fallback for hosts without target-instance lookup: search the fiber
      // tree for a dehydrated boundary whose host range contains the target.
      return findDehydratedSuspenseBoundaryForTarget(
        root.current.child,
        target,
      );
    }

    // A start marker with no live dehydrated fiber belongs to a boundary
    // nested inside an outer dehydrated one (its content has no fibers yet),
    // so resume the marker walk outward from that marker.
    let start = host.getEnclosingSuspenseBoundaryStart(target);
    while (start !== null) {
      const fiber = root.dehydratedBoundaries.get(start) ?? null;
      if (fiberSuspenseState(fiber)?.kind === "dehydrated") return fiber;
      start = host.getEnclosingSuspenseBoundaryStart(start);
    }

    return null;
  }

  function flushSync<T>(callback: () => T): T {
    if (renderingFiber !== null) {
      throw new Error(
        "flushSync cannot be called while rendering a component.",
      );
    }

    try {
      return runWithPriority(SyncLane, callback);
    } finally {
      flushSyncWork();
    }
  }

  function flushSyncWork(): void {
    if (commitDepth > 0) {
      needsPostCommitSyncFlush = true;
      return;
    }

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

  function flushPostCommitSyncWork(): void {
    if (
      commitDepth > 0 ||
      !needsPostCommitSyncFlush ||
      flushingPostCommitSyncWork
    ) {
      return;
    }

    flushingPostCommitSyncWork = true;
    try {
      do {
        nestedPostCommitSyncFlushes += 1;
        if (nestedPostCommitSyncFlushes > nestedPostCommitSyncFlushLimit) {
          throw new Error("Maximum update depth exceeded.");
        }
        needsPostCommitSyncFlush = false;
        flushSyncWork();
      } while (needsPostCommitSyncFlush);
    } finally {
      nestedPostCommitSyncFlushes = 0;
      flushingPostCommitSyncWork = false;
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
    transitionTypeHooks.record?.(root, lane);
    pendingRoots.add(root);
    if (currentCommitEffectPhase === BeforePaintEffect && isSyncLane(lane)) {
      needsPostCommitSyncFlush = true;
    }
  }

  function markRootCompleted(root: R, remainingLanes: Lanes): void {
    markRootFinished(root, remainingLanes);
    transitionTypeHooks.complete?.(root, remainingLanes);
  }

  function markCommitEffectPhase(root: R, phase: EffectPhase): void {
    root.commitEffectPhases |= 1 << phase;
  }

  function scheduleOrBatchRoot(root: R): void {
    if (batchDepth > 0) batchedRoots.add(root);
    else scheduleRoot(root);
  }

  function scheduleRoot(root: R): void {
    if (root.pendingCoordinatedCommit) return;

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
        scheduleRoot(root);
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
        scheduleRoot(root);
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
    const state = fiberSuspenseState(current);

    restartRootWork(root);

    if (state?.kind !== "dehydrated") {
      markHydrationRecovery(root, "root");
      forceClientRender(root);
      performRoot(root, true);
      return;
    }

    if (
      host.shouldRecoverSuspenseMismatchAtRoot?.(
        root.container,
        state.boundary,
      ) === true
    ) {
      markHydrationRecovery(root, "root");
      state.boundary.forceClientRender = true;
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
    if (root.pendingCoordinatedCommit) return;

    if (root.pendingLanes === NoLanes && root.wip === null) {
      pendingRoots.delete(root);
      return;
    }

    flushPendingReactiveEffects(root);

    if (root.parkedCoordinatedCommit) {
      root.parkedCoordinatedCommit = false;
      // The parked tree's lanes were never marked finished, so they are
      // still inside pendingLanes; anything beyond them is newer work.
      const supersededByNewerWork =
        (root.pendingLanes & ~root.renderLanes) !== NoLanes;
      if (
        !supersededByNewerWork &&
        root.wip === null &&
        root.finishedWork !== null
      ) {
        // Nothing changed while the animation ran: commit the parked tree
        // as-is (commitRoot re-parks it if yet another transition started
        // in between, e.g. a streaming reveal).
        if (commitRoot(root, root.finishedWork)) return;
        finishRootWork(root);
        flushPostCommitSyncWork();
        return;
      }
      // Newer work supersedes the parked commit — React cancels its
      // suspended commit the same way. restartRootWork restores the update
      // queues the parked render consumed, and the fresh render below
      // absorbs the parked lanes, so the latest state commits instead.
      restartRootWork(root);
    }

    const nextLanes = getNextLanes(root, root.renderLanes);
    if (nextLanes === NoLanes && root.wip === null) {
      root.callback = null;
      root.callbackPriority = NoLane;
      return;
    }

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
      resetContextStack(root);
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

    if (root.finishedWork !== null && commitRoot(root, root.finishedWork)) {
      return;
    }
    finishRootWork(root);
    flushPostCommitSyncWork();
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
    const wasHydratingCompletedBoundary =
      root.hydrationInitialElement === NoHydrationInitialElement &&
      (root.hydratingSuspenseBoundary !== null ||
        root.hydratingActivityBoundary !== null);
    root.wip = null;
    root.finishedWork = null;
    root.renderLanes = NoLanes;
    root.callback = null;
    root.callbackPriority = NoLane;
    // Retries recorded by the discarded render die with it; their thenables
    // stay covered by the root pings attached at capture time.
    if (root.pendingSuspenseRetries.length > 0) {
      root.pendingSuspenseRetries = [];
    }
    clearCommitIndex(root.commitIndex);
    resetHydrationPointers(root);
    resetContextStack(root);
    if (wasHydratingCompletedBoundary) root.isHydrating = false;
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
    if (root.hydratingActivityBoundary !== null) {
      abandonActivityHydration(root, error instanceof HydrationMismatchError);
    }

    if (isThenable(error)) {
      const boundary = findSuspenseBoundary(node);
      if (boundary !== null) {
        unwindContextTo(root, boundary);
        return captureSuspenseBoundary(boundary, error);
      }

      unwindContextTo(root, null);
      throw error;
    }

    if (error instanceof HydrationMismatchError) {
      unwindContextTo(root, null);
      throw error;
    }

    const boundary = findErrorBoundary(node);
    if (boundary !== null) {
      unwindContextTo(root, boundary);
      return captureErrorBoundary(boundary, error, node);
    }

    unwindContextTo(root, null);
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

    // Recorded before any path that can render descendants (including the
    // clone-and-descend bailout), so a capture always has a fresh watermark.
    if (node.tag === SuspenseTag || node.tag === ErrorBoundaryTag) {
      node.commitIndexCheckpoint = root.commitIndex.length;
    }

    if (canBailout(node, root)) {
      let hasChildWork = includesSomeLane(node.childLanes, root.renderLanes);
      if (!hasChildWork) {
        hasChildWork = lazilyPropagateParentContextChanges(node, root);
      }

      if (!hasChildWork) {
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
        if (node.tag === ContextProviderTag) pushContextProvider(node, root);
        cloneChildFibers(node);
        return;
      }
    }

    if (node.tag === ContextProviderTag) pushContextProvider(node, root);

    const hasOwnWork = includesSomeLane(node.lanes, root.renderLanes);
    node.lanes &= ~root.renderLanes;

    if (node.tag === FunctionTag) {
      renderFunction(node, root);
      return;
    }

    if (node.tag === ThenableTag) {
      reconcileCurrentChildren(
        node,
        readThenable(node.props.thenable as PromiseLike<AwaitedFigNode>),
        root,
      );
      return;
    }

    if (node.tag === TextTag) {
      if (
        __DEV__ &&
        (node.alternate === null ||
          node.alternate.props.nodeValue !== node.props.nodeValue)
      ) {
        host.validateTextNesting?.(
          String(node.props.nodeValue),
          hostAncestorTypes(node),
        );
      }
      if (tryHydrateText(node, root)) return;
      node.stateNode ??= host.createTextInstance(String(node.props.nodeValue));
      return;
    }

    if (node.tag === HostTag) {
      const type = String(node.type);
      const children = hostChildren(node.props);
      const hoisted = resolveHoistedFiber(node, root);

      if (__DEV__) {
        let ancestors: string[] | null = null;

        if (
          !hoisted &&
          node.alternate === null &&
          host.validateInstanceNesting
        ) {
          ancestors = hostAncestorTypes(node);
          host.validateInstanceNesting(type, node.props, ancestors);
        }

        // Text that becomes Text fibers is validated by the TextTag branch.
        if (host.validateTextNesting && shouldUseHostTextContent(node, root)) {
          const textContent = hostTextContent(children);
          if (textContent !== null) {
            ancestors ??= hostAncestorTypes(node);
            ancestors.unshift(type);
            host.validateTextNesting(textContent, ancestors);
          }
        }
      }

      if (!hoisted && tryHydrateInstance(node, root)) {
        reconcileCurrentChildren(node, children, root);
        return;
      }

      if (!hoisted) {
        node.stateNode ??= host.createInstance(
          type,
          node.props,
          hostParent(node),
        );
      }

      reconcileCurrentChildren(
        node,
        children === null || shouldUseHostTextContent(node, root)
          ? null
          : children,
        root,
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

    if (node.tag === ActivityTag && node.type === null) {
      beginHiddenBoundary(root, node);
      return;
    }

    if (node.tag === ActivityTag) {
      beginActivity(root, node);
      return;
    }

    if (node.tag === ViewTransitionTag) {
      beginViewTransition(node);
      return;
    }

    if (node.tag === PortalTag) {
      beginPortal(node);
      return;
    }

    reconcileCurrentChildren(node, node.props.children, root);
  }

  function beginViewTransition(node: F): void {
    if (__DEV__) {
      const name = (node.props as ViewTransitionProps).name;
      if (name === "none" || name === "") {
        throw new Error(
          `<ViewTransition> received the reserved name "${name}". ` +
            '"none" disables the browser feature and "" is not a valid ' +
            'view-transition-name; use "auto" or omit the prop for a ' +
            "generated name.",
        );
      }
      if (
        commitCoordinator?.viewTransitions !== true &&
        !didWarnMissingViewTransitionCoordinator
      ) {
        didWarnMissingViewTransitionCoordinator = true;
        const coordinatorDescription =
          commitCoordinator === null
            ? "this renderer has no commit coordinator with View Transition support"
            : `the installed commit coordinator "${commitCoordinator.name}" does not provide View Transition support`;
        console.error(
          `A <ViewTransition> rendered, but ${coordinatorDescription}. ` +
            "Install View Transition support for this renderer. Fig DOM " +
            "applications can call enableViewTransitions() from " +
            '"@bgub/fig-dom/view-transitions".',
        );
      }
    }
    node.stateNode ??= { autoName: null };
    reconcileCurrentChildren(node, node.props.children);
  }

  function beginActivity(root: R, node: F): void {
    const hidden = activityHidden(node.props);
    if (hidden) hasHiddenBoundaries = true;

    const state = ensureFiberActivityState(node);

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

    beginHiddenBoundary(root, node);
  }

  function beginHiddenBoundary(root: R, node: F): void {
    const hidden = activityHidden(node.props);
    if (hidden) hasHiddenBoundaries = true;
    const hiddenState = node.hiddenState;
    const previousHidden =
      node.alternate === null
        ? false
        : activityHidden(node.alternate.memoizedProps ?? {});

    ensureFiberActivityState(node);

    if (hidden !== previousHidden) {
      node.flags |= VisibilityFlag;
    }
    if (!hidden && hiddenState?.currentFirstChild != null) {
      node.flags |= VisibilityFlag;
    }

    // A reveal with pending offscreen work expands the render lanes so the
    // revealed subtree commits already up to date. Offscreen work skipped by
    // earlier bailouts is re-marked pending after commit.
    if (!hidden && previousHidden) {
      // Deferred effects can live below otherwise unchanged wrapper components.
      // Mark the committed hidden subtree so reveal traversal does not adopt
      // those wrappers and skip the newly armed effects underneath them.
      markSubtreeLanes(node.alternate?.child ?? null, root.renderLanes);
      if (
        includesSomeLane(node.childLanes, OffscreenLane) &&
        !includesSomeLane(root.renderLanes, OffscreenLane)
      ) {
        root.renderLanes = mergeLanes(root.renderLanes, OffscreenLane);
      }
    }

    reconcile(
      node,
      node.props.children,
      hiddenState?.currentFirstChild ?? node.alternate?.child ?? null,
      hiddenState?.currentFirstChild != null && node.alternate === null,
    );
    node.hiddenState = null;
  }

  function prepareToHydrateRoot(root: R): void {
    if (!root.isHydrating) return;

    const hydrationHost = requireHydrationHostConfig();
    root.hydrationParent = root.finishedWork;
    root.nextHydratableInstance = hydrationHost.getFirstHydratableChild(
      root.container,
    );
  }

  function tryHydrateInstance(node: F, root: R): boolean {
    if (!shouldHydrateFiber(root, node)) return false;

    const hydrationHost = requireHydrationHostConfig();
    const hydratable = root.nextHydratableInstance;
    const type = String(node.type);

    if (
      hydratable === null ||
      !hydrationHost.canHydrateInstance(hydratable, type, node.props)
    ) {
      throwHydrationMismatch(root, node, `<${type}>`);
    }

    node.stateNode = hydratable as Instance;
    recordCommitWork(root.commitIndex, node, UpdateFlag | HydrationFlag);
    root.hydrationParent = node;
    root.nextHydratableInstance = hydrationHost.getFirstHydratableChild(
      hydratable as Instance,
      node.props,
    );

    return true;
  }

  function tryHydrateText(node: F, root: R): boolean {
    if (!shouldHydrateFiber(root, node)) return false;

    const hydrationHost = requireHydrationHostConfig();
    const hydratable = root.nextHydratableInstance;
    const text = String(node.props.nodeValue);
    const suppressHydrationWarning =
      (node.return?.tag === HostTag &&
        node.return.props.suppressHydrationWarning === true) ||
      canHydratePendingSuspenseTextMismatch(root);

    if (
      hydratable === null ||
      !hydrationHost.canHydrateTextInstance(
        hydratable,
        text,
        suppressHydrationWarning,
      )
    ) {
      throwHydrationMismatch(root, node, "text");
    }

    node.stateNode = hydratable as TextInstance;
    recordCommitWork(root.commitIndex, node, UpdateFlag);
    root.nextHydratableInstance =
      hydrationHost.getNextHydratableSibling(hydratable);

    return true;
  }

  function shouldHydrateFiber(root: R, node: F): boolean {
    return (
      root.isHydrating &&
      node.alternate === null &&
      node.stateNode === null &&
      !insideHydrationExemptHost(node)
    );
  }

  // A fresh host that rendered during hydration without claiming a DOM node
  // (its instance was created out-of-band) renders its subtree fresh, so
  // descendants must not consume the outer hydration cursor. The walk stops
  // at the nearest host ancestor, or at any cloned fiber: hydration only
  // occurs in fully fresh subtrees.
  function insideHydrationExemptHost(node: F): boolean {
    for (
      let parent = node.return;
      parent !== null && parent.alternate === null;
      parent = parent.return
    ) {
      if (parent.tag !== HostTag) continue;
      return hydrationBypassedHost(parent);
    }

    return false;
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
        throwHydrationMismatch(root, node, undefined, " in Activity");
      }
      leaveActivityHydration(root, node);
      return;
    }

    if (!root.isHydrating || root.hydrationParent !== node) return;

    if (
      root.nextHydratableInstance !== null &&
      !(
        node.tag === HostTag &&
        host.canRetainHydrationTail?.(node.stateNode as Instance) === true
      )
    ) {
      throwHydrationMismatch(root, node);
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
      throwHydrationMismatch(
        root,
        node,
        undefined,
        " in Suspense",
        boundary.id ?? undefined,
      );
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
          fiberActivityState(parent)?.dehydrated != null)
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

  function requireHydrationHostConfig(): HostHydrationConfig<
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

    return host as HostHydrationConfig<Container, Instance, TextInstance>;
  }

  // The message and the recoverable-error fields derive from two facts: what
  // was expected (`<div>`/"text"; undefined means an unexpected extra node)
  // and whether the hydration cursor was empty — the expected-node throw
  // sites all test root.nextHydratableInstance directly.
  function throwHydrationMismatch(
    root: R,
    node: F,
    expected?: string,
    where = "",
    boundaryId?: string,
  ): never {
    const nothing = root.nextHydratableInstance === null;
    const message =
      expected === undefined
        ? `found an extra DOM node${where}`
        : nothing
          ? `expected ${expected}, but found no DOM node`
          : `expected ${expected}`;
    const error = new Error(`Hydration mismatch: ${message}.`);
    queueRecoverableError(root, node, error, {
      actual:
        expected === undefined
          ? "extra DOM node"
          : nothing
            ? "nothing"
            : "different DOM node",
      boundaryId,
      expected,
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
      !includesSomeLane(node.lanes, root.renderLanes) &&
      !contextDependenciesChanged(node, root)
    );
  }

  function contextDependenciesChanged(node: F, root: R): boolean {
    const dependencies = node.contextDependencies;
    if (dependencies === null) return false;

    for (const dependency of dependencies) {
      if (
        !Object.is(
          currentContextValue(root, dependency.context),
          dependency.memoizedValue,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  function currentContextValue(root: R, context: FigContext<unknown>): unknown {
    return root.contextValues.has(context)
      ? root.contextValues.get(context)
      : context.defaultValue;
  }

  function shouldUseHostTextContent(node: F, root = rootOf(node)): boolean {
    return (
      host.setTextContent !== undefined &&
      // A host created out-of-band during hydration (hoisted instance)
      // renders fresh: its text must replace any server content wholesale
      // rather than match against it.
      (!root.isHydrating || hydrationBypassedHost(node)) &&
      // Hydration adopted the text as a child fiber (it had to match the
      // server's text node); keep that shape on re-renders. Collapsing to
      // textContent would delete the adopted fiber and rewrite identical
      // text — flag noise that reads as a real mutation (and made view
      // transitions animate the first post-hydration commit).
      !adoptedSingleTextChild(node) &&
      hostTextContent(node.props.children) !== null
    );
  }

  function adoptedSingleTextChild(node: F): boolean {
    const child = node.alternate?.child ?? node.child;
    return child !== null && child.tag === TextTag && child.sibling === null;
  }

  function hydrationBypassedHost(node: F): boolean {
    return (
      node.alternate === null &&
      node.stateNode !== null &&
      (node.flags & HydrationFlag) === 0
    );
  }

  function resolveHoistedFiber(node: F, root: R): boolean {
    if (isHoistedFiber(node)) return true;
    if (
      node.tag !== HostTag ||
      node.stateNode !== null ||
      host.resolveHoistedInstance === undefined
    ) {
      return false;
    }

    const hydrating = shouldHydrateFiber(root, node);
    const instance = host.resolveHoistedInstance(
      String(node.type),
      node.props,
      hostParent(node),
    );
    if (instance === null) return false;

    requireHoistedAssetHostConfig();
    node.stateNode = instance;
    node.flags |= HoistedStaticFlag;
    // The resource lives out-of-band, so leave the hydration cursor for the
    // next ordinary sibling and route acquisition through placement commit.
    if (hydrating) node.flags |= PlacementFlag;
    return true;
  }

  function isHoistedFiber(node: F): boolean {
    return node.tag === HostTag && (node.flags & HoistedStaticFlag) !== 0;
  }

  function requireHoistedAssetHostConfig(): HostHoistedAssetConfig<
    Container,
    Instance,
    TextInstance
  > {
    if (hoistedAssetHostConfig !== null) return hoistedAssetHostConfig;

    if (
      host.resolveHoistedInstance === undefined ||
      host.commitHoistedInstance === undefined ||
      host.removeHoistedInstance === undefined ||
      host.updateHoistedInstance === undefined
    ) {
      throw new Error("Hoisted assets are not supported by this renderer.");
    }

    hoistedAssetHostConfig = host as HostHoistedAssetConfig<
      Container,
      Instance,
      TextInstance
    >;
    return hoistedAssetHostConfig;
  }

  function renderFunction(node: F, root: R): void {
    // Hot reload: run the latest version of this component's family. In
    // production the whole block strips out.
    if (__DEV__) {
      if (hasRefreshHandler()) {
        node.type = resolveLatestType(node.type) as F["type"];
      }
    }
    prepareHookRender(node, root);

    const previousDispatcher = setCurrentDispatcher(dispatcher);
    const previousDataStore = setCurrentDataStore(root.dataStore);
    try {
      if (__DEV__) {
        // Strict shadow pass: invoke the component once and discard every
        // trace so impure renders surface in development. Skipping
        // reconciliation keeps the pass free of child and deletion effects.
        const consumedBefore = root.consumedPendingQueues.length;
        const nextClientIdBefore = root.nextClientId;
        const shadowResult = (node.type as Component)(node.props);
        // Discarded promise children can still reject. Observe them without
        // comparing identities: mount-time useMemo intentionally recomputes
        // between the passes, while the committed result owns rendering.
        observeDiscardedPromiseChildren(shadowResult);
        if (currentHook !== null) throw hookOrderError("fewer");
        restoreConsumedPendingQueues(root, consumedBefore);
        // Client ids are attempt-scoped during the strict shadow pass: the
        // real invocation must observe the same allocation sequence.
        root.nextClientId = nextClientIdBefore;
        prepareHookRender(node, root);
        node.effects = null;
      }
      reconcileCurrentChildren(
        node,
        (node.type as Component)(node.props),
        root,
      );
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

  function prepareHookRender(node: F, root: R): void {
    renderingFiber = node;
    currentHook = node.alternate?.memoizedState ?? null;
    workInProgressHook = null;
    localIdCounter = 0;
    node.memoizedState = null;
    node.contextDependencies = null;
    root.dataStore.resetDataDependencies(node);
    node.dataDependenciesDirty = true;
    recordCommitWork(root.commitIndex, node);
  }

  function beginSuspense(node: F, hasOwnWork: boolean): void {
    const root = rootOf(node);
    const previousSuspenseState = fiberSuspenseState(node.alternate);

    node.boundaryState = null;

    if (previousSuspenseState?.kind === "dehydrated") {
      if (!hasOwnWork) {
        node.boundaryState = previousSuspenseState;
        return;
      }
      hydrateDehydratedSuspenseBoundary(node, previousSuspenseState);
      return;
    }

    if (tryDehydrateSuspenseBoundary(node)) return;

    node.suspenseQueueStart = root.consumedPendingQueues.length;

    if (previousSuspenseState === null) {
      beginSuspensePrimary(node, suspensePrimaryFiber(node.alternate));
      return;
    }

    const currentPrimary = suspensePrimaryFiber(node.alternate);
    if (currentPrimary !== null) {
      // Reveal of a re-suspended boundary: the committed primary was kept hidden
      // and its lanes were cleared (so blocked offscreen work could not busy-loop
      // the scheduler while suspended). Updates dispatched during the fallback
      // were parked in their hook queues. Mark the kept-hidden subtree with the
      // current render lanes so it re-renders instead of bailing out and adopting
      // the frozen clone — that re-render is what applies the parked updates.
      markSubtreeLanes(currentPrimary.child, root.renderLanes);
    }
    beginSuspensePrimary(
      node,
      currentPrimary,
      previousSuspenseState.primaryChild,
    );
    appendDeletions(node, suspenseFallbackFiber(node.alternate));
  }

  function markSubtreeLanes(node: F | null, lanes: Lanes): void {
    for (let child = node; child !== null; child = child.sibling) {
      child.lanes = mergeLanes(child.lanes, lanes);
      child.childLanes = mergeLanes(child.childLanes, lanes);
      markSubtreeLanes(child.child, lanes);
    }
  }

  function beginSuspensePrimary(
    boundary: F,
    currentPrimary: F | null,
    capturedPrimary: F | null = null,
  ): void {
    if (capturedPrimary !== null) hasHiddenBoundaries = true;
    const primary = suspensePrimaryWorkInProgress(
      boundary,
      currentPrimary,
      "visible",
      capturedPrimary,
    );
    boundary.child = primary;
  }

  function suspensePrimaryWorkInProgress(
    boundary: F,
    currentPrimary: F | null,
    mode: "visible" | "hidden",
    capturedPrimary: F | null = null,
  ): F {
    const props: Props = { mode, children: boundary.props.children };

    const primary =
      currentPrimary === null
        ? fiber(ActivityTag, null, null, props, null)
        : createWorkInProgress(currentPrimary, props);

    primary.hiddenState = {
      currentFirstChild: capturedPrimary,
    };
    primary.index = 0;
    primary.return = boundary;
    primary.sibling = null;
    return primary;
  }

  function suspenseFallbackWorkInProgress(
    boundary: F,
    currentFallback: F | null,
    index: number,
  ): F {
    const props: Props = { children: boundary.props.fallback };
    const fallback =
      currentFallback?.tag === FragmentTag
        ? createWorkInProgress(currentFallback, props)
        : fiber(FragmentTag, null, null, props, null);

    fallback.index = index;
    fallback.return = boundary;
    fallback.sibling = null;
    if (currentFallback === null) fallback.flags |= PlacementFlag;
    return fallback;
  }

  function suspensePrimaryFiber(node: F | null | undefined): F | null {
    const child = node?.child ?? null;
    return child?.tag === ActivityTag && child.type === null ? child : null;
  }

  function suspenseFallbackFiber(node: F | null | undefined): F | null {
    const primary = suspensePrimaryFiber(node);
    return primary === null ? (node?.child ?? null) : primary.sibling;
  }

  function cloneSuspendedPrimary(node: F | null, parent: F): F | null {
    let first: F | null = null;
    let previous: F | null = null;

    for (let current = node; current !== null; current = current.sibling) {
      const clone = createWorkInProgress(current, current.props);
      clone.return = parent;
      clone.child = cloneSuspendedPrimary(current.child, clone);
      clone.sibling = null;
      // The cloned primary is committed hidden while the boundary stays
      // suspended; it has no schedulable work. Any pending update inside it is
      // parked in its hook queue (restored as NoLane) and applied when the
      // suspense ping retries the reveal — clearing the lanes here keeps a
      // downgraded (OffscreenLane) update from busy-looping the scheduler via
      // the post-commit "let idle retries proceed" re-mark.
      clone.lanes = NoLanes;
      clone.childLanes = NoLanes;
      if (previous === null) first = clone;
      else previous.sibling = clone;
      previous = clone;
    }

    return first;
  }

  function tryDehydrateSuspenseBoundary(node: F): boolean {
    const root = rootOf(node);
    if (!shouldHydrateFiber(root, node)) return false;
    if (host.getSuspenseBoundary === undefined) return false;

    const hydratable = root.nextHydratableInstance;
    if (hydratable === null) return false;

    const boundary = host.getSuspenseBoundary(hydratable);
    if (boundary === null) return false;

    node.boundaryState = {
      boundary,
      idPath: hydrationIdPath(root, node),
      kind: "dehydrated",
      wasPending: boundary.status === "pending",
    };
    host.registerSuspenseBoundaryRetry?.(boundary, () =>
      scheduleFiber(node, DefaultLane),
    );
    root.nextHydratableInstance = nextAfterSuspenseBoundary(boundary);
    return true;
  }

  function hydrateDehydratedSuspenseBoundary(
    node: F,
    state: DehydratedSuspenseState<Instance, TextInstance>,
  ): void {
    const boundary = state.boundary;
    abandonedHydrationBoundaries.delete(node);
    if (node.alternate !== null) {
      abandonedHydrationBoundaries.delete(node.alternate);
    }

    if (!boundary.forceClientRender) {
      if (boundary.status === "completed") {
        enterSuspenseHydration(node, boundary);
        node.boundaryState = null;
        node.flags |= HydrationFlag;
        beginSuspensePrimary(node, suspensePrimaryFiber(node.alternate));
        return;
      }

      if (boundary.status === "pending") {
        node.boundaryState = state;
        return;
      }
    }

    if (boundary.status === "client-rendered") {
      queueClientRenderedSuspenseError(rootOf(node), node, boundary);
    }

    node.boundaryState = null;
    node.flags |= HydrationFlag;
    beginSuspensePrimary(node, suspensePrimaryFiber(node.alternate));
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

  function canHydratePendingSuspenseTextMismatch(root: R): boolean {
    const boundary = root.hydratingSuspenseBoundary;
    const state = fiberSuspenseState(boundary?.alternate);
    return state?.kind === "dehydrated" && state.wasPending;
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

    hasHiddenBoundaries = true;
    state.dehydrated = {
      boundary,
      idPath: hydrationIdPath(root, node),
    };
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

  // Any throw while hydrating a dehydrated Activity abandons the attempt. For
  // mismatches, clear the dehydrated template before root recovery so the
  // forced client render cannot recurse into the same failed hydration.
  function abandonActivityHydration(root: R, forceClientRender = false): void {
    if (forceClientRender) {
      const state = fiberActivityState(root.hydratingActivityBoundary);
      if (state !== null) state.dehydrated = null;
    }
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
    const previousErrorState = fiberErrorBoundaryState(node.alternate);

    node.boundaryState = previousErrorState;

    reconcileCurrentChildren(
      node,
      previousErrorState === null
        ? node.props.children
        : errorBoundaryFallback(node, previousErrorState),
    );
  }

  function errorBoundaryFallback(node: F, state: ErrorBoundaryState): FigNode {
    const fallback = node.props.fallback as ErrorBoundaryProps["fallback"];
    return typeof fallback === "function" && !isThenable(fallback)
      ? fallback(state.error, state.info)
      : (fallback as FigNode);
  }

  function beginPortal(node: F): void {
    reconcileCurrentChildren(node, node.props.children as FigNode);
  }

  function updateStateHook<S>(
    initialState: S | (() => S),
  ): [S, StateSetter<S>] {
    const hook = updateQueuedHook(StateHook, initialState);
    const queue = hook.queue;
    const fiber = requireRenderingFiber();

    // The queue object persists across renders, so the dispatch created on
    // mount is always present afterwards.
    queue.dispatch ??= (action: StateUpdate<S>) => {
      if (renderingFiber !== null) {
        throw new Error(
          "State updates are not allowed while rendering a component.",
        );
      }

      scheduleHookUpdate(fiber, queue, action, requestUpdateLane());
    };

    return [hook.memoizedState, queue.dispatch];
  }

  function updateActionStateHook<S, Args extends unknown[]>(
    action: ActionStateAction<S, Args>,
    initialState: S,
  ): [S, ActionStateRunner<Args>, boolean] {
    const hook: Hook<ActionState<S, Args>> = updateQueuedHook(
      ActionStateHook,
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

    if (instance.runner === null) {
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

      instance.runner = (...args: Args) => {
        if (renderingFiber !== null) {
          throw new Error(
            "Action state updates are not allowed during render.",
          );
        }

        // Last-run-wins: a new run aborts and retires the previous one,
        // releasing its pending slot now (on DefaultLane — the retired run's
        // held transition lane may never render). A retired run's settlement
        // — value or rejection — never touches state, error, or pending.
        runLatest(
          instance,
          fiber,
          (signal) => instance.action(instance.value, ...args, signal),
          updatePending,
          (lane, value, failed) => {
            if (failed) finish(lane, value);
            else finish(lane, NoActionStateError, value as S);
          },
        );
      };
    }

    if (hook.memoizedState.error !== NoActionStateError) {
      throw hook.memoizedState.error;
    }

    return [
      hook.memoizedState.value,
      instance.runner,
      hook.memoizedState.pending > 0,
    ];
  }

  function updateIdHook(): string {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook(IdHook) as Hook<string> | null;
    const id =
      oldHook === null
        ? createFiberId(rootOf(fiber), fiber, localIdCounter)
        : oldHook.memoizedState;
    localIdCounter += 1;

    appendHook(createHook(IdHook, id));
    return id;
  }

  function updateMemoHook<T>(calculate: () => T, deps: DependencyList): T {
    requireRenderingFiber();
    const previous = (updateHook(MemoHook) as Hook<MemoState<T>> | null)
      ?.memoizedState;
    const state =
      previous !== undefined && areHookInputsEqual(deps, previous.deps)
        ? previous
        : { deps, value: calculate() };

    appendHook(createHook(MemoHook, state));
    return state.value;
  }

  function updateDeferredValueHook<T>(
    value: T,
    initialValue: T | undefined,
    hasInitialValue: boolean,
  ): T {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook(DeferredValueHook) as Hook<T> | null;
    let next =
      oldHook === null
        ? initialDeferredValue(value, initialValue, hasInitialValue)
        : oldHook.memoizedState;

    if (!Object.is(next, value)) {
      if (isTransitionOrDeferredRender(rootOf(fiber))) {
        next = value;
      } else {
        scheduleFiber(fiber, DeferredLane);
      }
    }

    appendHook(createHook(DeferredValueHook, next));
    return next;
  }

  function initialDeferredValue<T>(
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
      instance: { controller: null, generation: 0 },
      pendingCount: 0,
      start: null,
    };
    const hook: Hook<TransitionState> = updateQueuedHook(
      TransitionHook,
      initialState,
    );
    const queue = hook.queue;

    let start = hook.memoizedState.start;
    if (start === null) {
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

      const instance = hook.memoizedState.instance;
      start = (
        callback: (signal: AbortSignal) => void | PromiseLike<void>,
        options?: TransitionOptions,
      ) => {
        if (renderingFiber !== null) {
          throw new Error(
            "Transitions cannot be started while rendering a component.",
          );
        }

        // One cancellation domain per hook: a new start aborts and retires
        // the previous pending run, releasing its pending slot now so an
        // ignored signal or hung promise can never pin isPending. The
        // decrement goes to DefaultLane — the retired run's own transition
        // lane is held until its callback settles (possibly never), and a
        // cancelled run has nothing to commit atomically with.
        runLatest(
          instance,
          fiber,
          callback,
          updatePending,
          (lane, value, failed, asynchronous) => {
            updatePending(-1, lane);
            if (failed) {
              if (!asynchronous) throw value;
              queueMicrotask(() => {
                throw value;
              });
            }
          },
          options,
        );
      };
      hook.memoizedState.start = start;
    }

    return [hook.memoizedState.pendingCount > 0, start];
  }

  // A transition and an action are the same cancellable effect up to how
  // their result is folded into state. This owns the shared protocol: one
  // scope, one generation token, and settlements from only the latest run.
  function runLatest<T>(
    instance: RunInstance,
    fiber: F,
    run: (signal: AbortSignal) => T | PromiseLike<T>,
    updatePending: (delta: 1 | -1, lane: Lane) => void,
    settled: (
      lane: Lane,
      value: unknown,
      failed: boolean,
      asynchronous: boolean,
    ) => void,
    options?: TransitionOptions,
  ): void {
    if (retireRun(instance)) updatePending(-1, DefaultLane);
    const lane = claimNextTransitionLane();
    const controller = new AbortController();
    const generation = (instance.generation += 1);
    instance.controller = controller;
    updatePending(1, SyncLane);

    const settle = (
      value: unknown,
      failed: boolean,
      asynchronous: boolean,
    ): void => {
      if (generation !== instance.generation) return;
      instance.controller = null;
      settled(lane, value, failed, asynchronous);
    };

    // A run started after the owner unmounted (deletion severs the fiber's
    // root path) still executes for its side effects, just without an
    // ambient data store; its settlements schedule into the void.
    const store = rootOfOrNull(fiber)?.dataStore;
    let result: T | PromiseLike<T>;
    try {
      const invoke = () =>
        runWithTransitionLane(lane, () => run(controller.signal), options);
      result = store === undefined ? invoke() : store.run(invoke);
    } catch (error) {
      settle(error, true, false);
      return;
    }

    if (!isThenable(result)) {
      settle(result, false, false);
      return;
    }

    result.then(
      (value) => settle(value, false, true),
      (error: unknown) => settle(error, true, true),
    );
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
      hook.baseQueue = consumePendingHookQueue(root, hook, pending);
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
    const oldHook = updateHook(ExternalStoreHook) as Hook<
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

    recordCommitWork(root.commitIndex, fiber, StoreConsistencyFlag);
    appendHook(createHook(ExternalStoreHook, state));
    return value;
  }

  function updateStableEventHook<Args extends unknown[], Result>(
    handler: (...args: Args) => Result,
  ): (...args: StableEventCallerArgs<Args>) => Result {
    requireRenderingFiber();
    const oldHook = updateHook(
      StableEventHook,
    ) as Hook<StableEventState> | null;
    const instance =
      oldHook?.memoizedState.instance ?? createStableEventInstance();

    appendHook(
      createHook(StableEventHook, {
        instance,
        next: handler as StableEventHandler,
      }),
    );
    return instance.stable as (...args: StableEventCallerArgs<Args>) => Result;
  }

  function createStableEventInstance(): StableEventInstance {
    const instance: StableEventInstance = {
      controller: null,
      handler: null,
      live: false,
      stable: (...args) => {
        if (renderingFiber !== null) {
          throw new Error(
            "Stable events cannot be called while rendering a component.",
          );
        }

        const handler = instance.handler;
        if (handler === null) {
          throw new Error(
            "Stable events cannot be called before their first commit.",
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
        "useSyncExternalStore requires getServerSnapshot during hydration.",
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
        // Pin the rebase point at the FIRST skipped update (mergeQueues
        // returns the appended tail, so comparing against cloneUpdate would
        // re-snapshot on every skip and lose earlier skipped reductions).
        if (newBaseQueue === null) newBaseState = state;
        newBaseQueue = mergeQueues(newBaseQueue, cloneUpdate);
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
    action: StateUpdate<S>,
    lane: Lane,
  ): void {
    if (__DEV__ && currentCommitEffectPhase === BeforeLayoutEffect) {
      throw new Error(
        "State updates are not allowed from useBeforeLayout effects.",
      );
    }

    lane = hiddenSubtreeLane(fiber, lane);
    const update = new HookUpdate(action, lane);
    queue.pending = mergeQueues(queue.pending, update);
    scheduleFiber(fiber, lane);
  }

  // Updates inside hidden boundaries are downgraded to the
  // offscreen lane at schedule time, so normal renders never descend for
  // hidden work and idle renders prerender it. A boundary mid-transition
  // (generations disagree) is treated as visible so updates are never
  // wrongly deferred.
  function hiddenSubtreeLane(node: F, lane: Lane): Lane {
    if (!hasHiddenBoundaries || lane === OffscreenLane) return lane;

    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (
        parent.tag === ActivityTag &&
        fiberActivityState(parent)?.hidden === true
      ) {
        return OffscreenLane;
      }
    }

    return lane;
  }

  function createFiberId(root: R, fiber: F, localId: number): string {
    if (!root.isHydrating || insideHydrationExemptHost(fiber)) {
      const id = root.nextClientId;
      root.nextClientId += 1;
      // Server paths contain only lowercase base-32 segments. The uppercase
      // client discriminator therefore cannot collide with hydrated ids.
      return `${root.identifierPrefix}fig-C-${id.toString(32)}`;
    }

    return `${root.identifierPrefix}fig-${hydrationIdPath(root, fiber)}-${localId.toString(32)}`;
  }

  function hydrationIdPath(root: R, fiber: F): string {
    const suspense = root.hydratingSuspenseBoundary;
    if (suspense !== null) {
      const state = fiberSuspenseState(suspense.alternate);
      if (state?.kind === "dehydrated") {
        return appendIdPath(state.idPath, fiberPath(fiber, suspense));
      }
    }

    const activity = root.hydratingActivityBoundary;
    if (activity !== null) {
      const base = fiberActivityState(activity)?.dehydrated?.idPath ?? null;
      if (base !== null) {
        return appendIdPath(base, fiberPath(fiber, activity));
      }
    }

    return fiberPath(fiber, null);
  }

  function appendIdPath(base: string, relative: string): string {
    return relative === "" ? base : `${base}-${relative}`;
  }

  function fiberPath(fiber: F, stopBefore: F | null): string {
    const parts: string[] = [];

    for (
      let node: F | null = fiber;
      node !== null && node !== stopBefore && node.tag !== RootTag;
      node = node.return
    ) {
      // Suspense inserts a private Activity fiber around its primary tree.
      // The server has no corresponding element, so it is transparent to the
      // canonical id path just like React's implementation-only indirections.
      if (node.tag !== ActivityTag || node.type !== null) {
        parts.push(node.index.toString(32));
      }
    }

    return parts.reverse().join("-");
  }

  function consumePendingHookQueue<S>(
    root: R,
    hook: Hook<S>,
    pending: HookUpdate<S>,
  ): HookUpdate<S> | null {
    const queue = hook.queue;
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
    phase: EffectPhase,
    create: EffectCallback,
    deps?: DependencyList,
  ): void {
    const fiber = requireRenderingFiber();
    const oldHook = updateHook(phase) as Hook<Effect> | null;
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
      strictRan: __DEV__ && previousEffect?.strictRan === true,
    };
    const hook = createHook(phase, effect);

    appendHook(hook);

    if (hasChanged) {
      fiber.effects ??= [];
      fiber.effects.push(effect);
      const root = rootOf(fiber);
      recordCommitWork(root.commitIndex, fiber, EffectFlag);
      markCommitEffectPhase(root, phase);
    }
  }

  function readContextValue<T>(context: FigContext<T>): T {
    if (renderingFiber === null) {
      throw new Error(
        "readContext can only be called while rendering a component.",
      );
    }

    const root = rootOf(renderingFiber);
    const contextKey = context as FigContext<unknown>;
    const value = currentContextValue(root, contextKey);

    addContextDependency(renderingFiber, contextKey, value);
    return value as T;
  }

  function pushContextProvider(node: F, root = rootOf(node)): void {
    const context = node.type as FigContext<unknown>;
    const values = root.contextValues;
    const hadPrevious = values.has(context);
    const previous = values.get(context);
    values.set(context, node.props.value);
    root.contextStack.push({ context, hadPrevious, previous, provider: node });
  }

  function popContextProvider(node: F): void {
    const root = rootOf(node);
    const entry = root.contextStack.pop();
    if (entry === undefined || entry.provider !== node) {
      resetContextStack(root);
      return;
    }
    restoreContextEntry(root, entry);
  }

  function unwindContextTo(root: R, node: F | null): void {
    while (root.contextStack.length > 0) {
      const entry = root.contextStack[root.contextStack.length - 1];
      if (node !== null && isAncestorOf(entry.provider, node)) return;
      restoreContextEntry(
        root,
        root.contextStack.pop() as ContextStackEntry<
          Container,
          Instance,
          TextInstance
        >,
      );
    }
  }

  function restoreContextEntry(
    root: R,
    entry: ContextStackEntry<Container, Instance, TextInstance>,
  ): void {
    if (entry.hadPrevious) {
      root.contextValues.set(entry.context, entry.previous);
    } else {
      root.contextValues.delete(entry.context);
    }
  }

  function resetContextStack(root: R): void {
    root.contextValues = new Map();
    root.contextStack = [];
  }

  function isAncestorOf(ancestor: F, node: F): boolean {
    for (let parent: F | null = node; parent !== null; parent = parent.return) {
      if (parent === ancestor) return true;
    }
    return false;
  }

  function addContextDependency(
    node: F,
    context: FigContext<unknown>,
    memoizedValue: unknown,
  ): void {
    node.contextDependencies ??= [];
    const dependency = contextDependency(node, context);

    if (dependency === null) {
      node.contextDependencies.push({ context, memoizedValue });
    } else {
      dependency.memoizedValue = memoizedValue;
    }
  }

  function contextDependency(
    node: F,
    context: FigContext<unknown>,
  ): ContextDependency | null {
    return (
      node.contextDependencies?.find(
        (dependency) => dependency.context === context,
      ) ?? null
    );
  }

  function appendContextDependencies(
    list: FigContext<unknown>[] | null,
    dependencies: ContextDependency[] | null,
  ): FigContext<unknown>[] | null {
    if (dependencies === null) return list;

    let next = list;
    for (const dependency of dependencies) {
      next = appendContext(next, dependency.context);
    }
    return next;
  }

  function appendContextList(
    list: FigContext<unknown>[] | null,
    contexts: FigContext<unknown>[] | null,
  ): FigContext<unknown>[] | null {
    if (contexts === null) return list;

    let next = list;
    for (const context of contexts) next = appendContext(next, context);
    return next;
  }

  function appendContext(
    list: FigContext<unknown>[] | null,
    context: FigContext<unknown>,
  ): FigContext<unknown>[] {
    if (list === null) return [context];
    if (!list.includes(context)) list.push(context);
    return list;
  }

  function contextListIncludes(
    list: FigContext<unknown>[] | null,
    context: FigContext<unknown>,
  ): boolean {
    return list?.includes(context) === true;
  }

  function updateHook(kind: HookKind): Hook | null {
    const hook = currentHook;

    if (hook === null) {
      if (didRenderBefore(renderingFiber)) throw hookOrderError("more");
      return null;
    }

    if (hook.kind !== kind) {
      throw new Error(
        `Hook order changed: expected ${hookKindName(hook.kind)}, ` +
          `received ${hookKindName(kind)}.`,
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
    let subtreeFlags = NoFlags;
    let contextSubtreeDependencies: FigContext<unknown>[] | null = null;

    while (child !== null) {
      childLanes = mergeLanes(childLanes, child.lanes);
      childLanes = mergeLanes(childLanes, child.childLanes);
      subtreeFlags |= childSubtreeFlags(child);
      contextSubtreeDependencies = appendContextDependencies(
        contextSubtreeDependencies,
        child.contextDependencies,
      );
      contextSubtreeDependencies = appendContextList(
        contextSubtreeDependencies,
        child.contextSubtreeDependencies,
      );
      child = child.sibling;
    }

    if (isNewHostInstance(node)) {
      host.finalizeInitialInstance?.(node.stateNode as Instance, node.props);
      if (!setInitialHostTextContent(node)) {
        // A reused instance (re-assembled on Suspense reveal) may still hold
        // stale children from before the fallback; clear before re-appending.
        // Gated on a reused node (alternate) with child fibers, so fresh mounts
        // and content set via props (innerHTML/textarea) are left untouched.
        if (node.alternate !== null && node.child !== null) {
          host.setTextContent?.(node.stateNode as Instance, "");
        }
        appendAllHostChildren(node.stateNode as Instance, node.child);
      }
      if (host.appendInitialChild !== undefined) node.flags |= AssembledFlag;
    }

    if (node.tag === ViewTransitionTag) node.flags |= ViewTransitionStaticFlag;

    if (
      node.tag === AssetsTag &&
      host.commitAssetResources !== undefined &&
      (node.committedProps === null ||
        node.committedProps.assets !== node.props.assets)
    ) {
      recordCommitWork(rootOf(node).commitIndex, node, AssetFlag);
    }

    node.childLanes = childLanes;
    node.subtreeFlags = subtreeFlags;
    node.contextSubtreeDependencies = contextSubtreeDependencies;
    node.memoizedProps = node.props;
    if (node.tag === ContextProviderTag && (node.flags & AdoptedFlag) === 0) {
      popContextProvider(node);
    }
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
      // Hoisted instances live out-of-band; commit acquires them instead.
      if (isHoistedFiber(node)) continue;

      if (node.tag === HostTag || node.tag === TextTag) {
        host.appendInitialChild(parent, hostNode(node));
      } else {
        appendAllHostChildren(parent, node.child);
      }
    }
  }

  function reconcileCurrentChildren(
    parent: F,
    children: FigNode,
    root = rootOf(parent),
  ): void {
    reconcile(parent, children, parent.alternate?.child ?? null, false, root);
  }

  function reconcile(
    parent: F,
    children: FigNode,
    currentFirstChild: F | null,
    forcePlacement: boolean,
    root = rootOf(parent),
  ): void {
    const nextChildren = collectChildren(children);
    const seenKeys = __DEV__ ? new Set<string>() : null;

    parent.child = null;
    parent.deletions = null;

    let previous: F | null = null;
    let old: F | null = currentFirstChild;
    let index = 0;
    let lastPlacedIndex = 0;
    const isHydratingNewTree =
      parent.tag !== PortalTag &&
      root.isHydrating &&
      currentFirstChild === null;

    for (; old !== null && index < nextChildren.length; index += 1) {
      const child = nextChildren[index];
      if (!sameChildKey(old, child, index) || !sameType(old, child)) {
        break;
      }
      validateChildKey(child, seenKeys);

      const next = createWorkInProgress(old, propsFor(child));
      next.index = index;
      next.return = parent;

      const updateFlags = hostUpdateFlags(old, next.props);
      if (updateFlags !== NoFlags) {
        recordCommitWork(root.commitIndex, next, updateFlags);
      }
      if (forcePlacement) {
        next.flags |= PlacementFlag;
      } else {
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
        validateChildKey(nextChildren[index], seenKeys);
        const next = fiberFrom(nextChildren[index]);
        if (next === null) continue;

        next.index = index;
        next.return = parent;
        if (!isHydratingNewTree) next.flags |= PlacementFlag;
        previous = appendChild(parent, previous, next);
      }
      return;
    }

    let existingByKey: Map<string, F> | null = null;
    let existingByIndex: Map<number, F> | null = null;
    for (; old !== null; old = old.sibling) {
      if (old.key === null) {
        (existingByIndex ??= new Map()).set(old.index, old);
      } else {
        (existingByKey ??= new Map()).set(String(old.key), old);
      }
    }

    for (; index < nextChildren.length; index += 1) {
      const child = nextChildren[index];
      validateChildKey(child, seenKeys);
      const key = childExplicitKey(child);
      const matched =
        key === null ? existingByIndex?.get(index) : existingByKey?.get(key);
      const canReuse = matched !== undefined && sameType(matched, child);
      const next = canReuse
        ? createWorkInProgress(matched, propsFor(child))
        : fiberFrom(child);

      if (next === null) continue;

      next.index = index;
      next.return = parent;

      if (canReuse) {
        if (key === null) {
          existingByIndex?.delete(index);
        } else {
          existingByKey?.delete(key);
        }
        const updateFlags = hostUpdateFlags(matched, next.props);
        if (updateFlags !== NoFlags) {
          recordCommitWork(root.commitIndex, next, updateFlags);
        }
        if (forcePlacement || matched.index < lastPlacedIndex) {
          next.flags |= PlacementFlag;
        } else {
          lastPlacedIndex = matched.index;
        }
      } else {
        if (!isHydratingNewTree) next.flags |= PlacementFlag;
      }

      previous = appendChild(parent, previous, next);
    }

    if (existingByKey !== null) {
      for (const child of existingByKey.values()) appendDeletion(parent, child);
    }
    if (existingByIndex !== null) {
      for (const child of existingByIndex.values()) {
        appendDeletion(parent, child);
      }
    }
  }

  function appendDeletions(parent: F, firstChild: F | null): void {
    for (let child = firstChild; child !== null; child = child.sibling) {
      appendDeletion(parent, child);
    }
  }

  function appendDeletion(parent: F, child: F): void {
    const root = rootOf(parent);
    parent.deletions ??= [];
    parent.deletions.push(child);
    root.needsCommitDeletions = true;
    recordCommitWork(root.commitIndex, parent, DeletionFlag);
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
    // Hydration-adopted single-text children keep their fiber shape: the
    // text fiber owns updates (commitTextUpdate). Setting textContent here
    // would replace the very node that fiber points at.
    if (adoptedSingleTextChild(current)) return false;

    const previousText = hostTextContent(previous.children);
    const nextText = hostTextContent(next.children);

    return (
      previousText !== nextText || (nextText !== null && current.child !== null)
    );
  }

  function hostPropsChanged(previous: Props, next: Props): boolean {
    let previousCount = 0;

    for (const key in previous) {
      if (!Object.hasOwn(previous, key)) continue;
      if (!committedHostProp(key)) continue;
      previousCount += 1;
      if (!(key in next) || previous[key] !== next[key]) return true;
    }

    let nextCount = 0;

    for (const key in next) {
      if (!Object.hasOwn(next, key)) continue;
      if (committedHostProp(key)) nextCount += 1;
    }

    return previousCount !== nextCount;
  }

  function committedHostProp(name: string): boolean {
    return name !== "children";
  }

  function commitRoot(root: R, finishedWork: F): boolean {
    if (
      !root.pendingCoordinatedCommit &&
      commitCoordinator?.suspend?.(root, () => scheduleRoot(root)) === true
    ) {
      parkCoordinatedCommit(root);
      return true;
    }

    commitDepth += 1;
    try {
      // Taken before any commit step runs: the closures below may defer
      // completion across ticks (view transitions), and a later render must
      // not see or clear this commit's retries. Most commits carry none —
      // the shared empty list avoids a per-commit allocation, and holding
      // root's own (empty) array instead would let a later render's pushes
      // leak into this commit's deferred attach.
      let suspenseRetries = noSuspenseRetries;
      if (root.pendingSuspenseRetries.length > 0) {
        suspenseRetries = root.pendingSuspenseRetries;
        root.pendingSuspenseRetries = [];
      }
      commitLiveHookInstances(root);
      if (__DEV__) assertLiveHookInstanceParity(finishedWork.child);
      if (hasHiddenBoundaries) armRevealedHiddenBoundaries(finishedWork.child);
      commitEffects(root, finishedWork.child, BeforeLayoutEffect);
      const commitHostChanges = () => {
        if (root.clearContainerBeforeCommit) {
          requireHydrationHostConfig().clearContainer(root.container);
        }
        if (root.needsCommitDeletions) {
          commitDeletions(root);
          root.needsCommitDeletions = false;
        }
        if (__DEV__) assertDeletionCommitParity(finishedWork);
        commitAssetResourceUpdates(root);
        if (__DEV__) assertAssetResourceCommitParity(finishedWork.child);
        commitDataDependencies(root);
        if (__DEV__) assertDataDependencyCommitParity(finishedWork.child);
        commitHostUpdates(root);
        if (__DEV__) assertHostUpdateCommitParity(finishedWork.child);
        commitMutationEffects(finishedWork.child);
        if (hasHiddenBoundaries)
          commitHiddenBoundaryVisibility(finishedWork.child);
        if (__DEV__) assertPlacedHostCommitParity(finishedWork.child, false);
        root.clearContainerBeforeCommit = false;
      };
      const completeCommit = () => {
        // Recompute from committed reality: the eager render-time set is sticky, so
        // once the last hidden boundary reveals or unmounts this clears the flag and
        // the per-update parent-walk is skipped again.
        hasHiddenBoundaries = hiddenStates.size > 0;
        root.current = finishedWork;
        deactivateHydration(root);
        root.hydrationInitialElement = NoHydrationInitialElement;
        root.consumedPendingQueues = [];
        // Remaining work is read from the committed tree, not just from
        // pendingLanes minus renderLanes: an update dispatched after its fiber
        // rendered but before this line (setState in a commit-phase effect, or a
        // same-lane update while a time-sliced render of that lane was yielded)
        // lands on a lane inside renderLanes, and stripping it here would park it
        // in its hook queue forever. markLanes/markChildLanes recorded such
        // updates on the finishedWork fibers (begin cleared the lanes that
        // actually rendered), so merging finishedWork.lanes | childLanes revives
        // exactly the work still owed without resurrecting completed lanes.
        markRootCompleted(
          root,
          (root.pendingLanes & ~root.renderLanes) |
            finishedWork.lanes |
            finishedWork.childLanes,
        );
        if (includesSomeLane(finishedWork.childLanes, OffscreenLane)) {
          markRootPending(root, OffscreenLane);
          // A suspension after reveal lane expansion may have marked offscreen
          // work suspended alongside the visible lanes; let idle retries proceed.
          root.suspendedLanes &= ~OffscreenLane;
        }
        try {
          commitExternalStores(root);
          if (__DEV__) assertExternalStoreCommitParity(finishedWork.child);
          attachCommittedSuspenseRetries(root, suspenseRetries);
          scheduleDehydratedSuspenseRetries(root);
          commitEffects(root, finishedWork.child, BeforePaintEffect);
          flushCaughtBoundaryErrors(root);
          if (__DEV__) assertCaughtBoundaryErrorParity(finishedWork.child);
        } finally {
          // Once the tree is current its flags must be cleared even when a
          // commit step throws, or a later render would adopt stale flags.
          collectReactiveEffects(root, finishedWork.child);
          clearTransientFlags(finishedWork);
          scheduleReactiveEffects(root);
          clearCommitIndex(root.commitIndex);
        }
        if (__DEV__ && root.devtools) {
          emitDevtoolsCommit(host, root);
        }
        flushRecoverableErrors(root);
        // Host mutations just landed: make the work loop yield at its next check
        // so the host paints before further scheduled work (React does the same
        // from commitRoot).
        requestPaint();
      };
      const finishDeferredCommit = () => {
        if (!root.pendingCoordinatedCommit) return;
        root.pendingCoordinatedCommit = false;
        finishRootWork(root);
        flushPostCommitSyncWork();
      };
      if (commitCoordinator !== null) {
        let didRunMutation = false;
        let didFinishCapture = false;
        const context: ReconcilerCommitContext<Container> = {
          container: root.container,
          finishedWork,
          priority: commitPriority(root.renderLanes),
          root,
          captureFinished() {
            if (!didRunMutation) {
              throw new Error(
                "A commit coordinator cannot finish capture before running the mutation transaction.",
              );
            }
            didFinishCapture = true;
            finishDeferredCommit();
          },
          runMutation(afterMutation) {
            if (didRunMutation) {
              throw new Error(
                "A commit coordinator may run its mutation transaction only once.",
              );
            }
            didRunMutation = true;
            const isDeferredCommit = root.pendingCoordinatedCommit;
            if (isDeferredCommit) commitDepth += 1;
            try {
              commitHostChanges();
              completeCommit();
              return afterMutation();
            } catch (error) {
              if (!isDeferredCommit) throw error;
              const info =
                root.uncaughtErrorInfo ?? errorInfoFor(root.current, error);
              restartRootWork(root);
              clearRootAfterUncaughtError(root);
              reportUncaughtError(root, error, info);
              if (root.onUncaughtError === null) {
                setTimeout(() => {
                  throw error;
                });
              }
              return undefined;
            } finally {
              if (isDeferredCommit) commitDepth -= 1;
            }
          },
        };
        switch (commitCoordinator.commit(context)) {
          case false:
            if (didRunMutation) {
              throw new Error(
                "A commit coordinator returned false after running the mutation transaction.",
              );
            }
            break;
          case "committed":
            if (!didRunMutation) {
              throw new Error(
                'A commit coordinator returned "committed" without running the mutation transaction.',
              );
            }
            return false;
          case "deferred":
            root.pendingCoordinatedCommit = true;
            root.callback = null;
            root.callbackPriority = NoLane;
            if (didFinishCapture) finishDeferredCommit();
            return true;
        }
      }
      commitHostChanges();
      completeCommit();
      return false;
    } finally {
      commitDepth -= 1;
    }
  }

  function parkCoordinatedCommit(root: R): void {
    root.parkedCoordinatedCommit = true;
    // The scheduler callback that carried this attempt is spent; clear it so
    // the coordinator's resume callback (or a newer update) is not deduped.
    root.callback = null;
    root.callbackPriority = NoLane;
  }

  function scheduleDehydratedSuspenseRetries(root: R): void {
    if (
      !root.isHydrationRoot &&
      root.dehydratedSuspenseCount === 0 &&
      !root.needsRootHydrationCompletion
    ) {
      root.dehydratedBoundaries = new Map();
      return;
    }

    const boundaries: F[] = [];
    root.dehydratedBoundaries = new Map();
    const dehydratedSuspenseCount = collectDehydratedSuspense(
      root.current.child,
      boundaries,
      root.dehydratedBoundaries,
    );
    updateDehydratedSuspenseCount(root, dehydratedSuspenseCount);
    if (boundaries.length === 0) return;

    queueMicrotask(() => {
      for (const boundary of boundaries) {
        const state = fiberSuspenseState(boundary);
        if (state?.kind !== "dehydrated") continue;

        const lane = dehydratedSuspenseRetryLane(state.boundary);
        if (lane !== NoLane) scheduleFiber(boundary, lane);
      }
    });
  }

  function collectDehydratedSuspense(
    node: F | null,
    boundaries: F[],
    byStartMarker: Map<HostNode<Instance, TextInstance>, F>,
  ): number {
    let count = 0;
    walkFiberForest(node, (cursor) => {
      const state = fiberSuspenseState(cursor);
      if (state?.kind === "dehydrated") {
        count += 1;
        byStartMarker.set(state.boundary.start, cursor);
        // A dehydrated boundary has no live children to descend into, but its
        // siblings may be retriable too (e.g. several boundaries inside one
        // revealed Activity), so keep walking the sibling chain.
        if (
          !abandonedHydrationBoundaries.has(cursor) &&
          dehydratedSuspenseRetryLane(state.boundary) !== NoLane
        ) {
          boundaries.push(cursor);
        }
        return false;
      }
      return true;
    });
    return count;
  }

  function updateDehydratedSuspenseCount(root: R, count: number): void {
    const previous = root.dehydratedSuspenseCount;
    root.dehydratedSuspenseCount = count;
    if ((previous > 0 || root.needsRootHydrationCompletion) && count === 0) {
      root.needsRootHydrationCompletion = false;
      host.completeRootHydration?.(root.container);
    }
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

  function flushCaughtBoundaryErrors(root: R): void {
    if (root.committedCaughtErrors.length > 0) {
      const boundaries = root.committedCaughtErrors;
      root.committedCaughtErrors = [];
      for (const boundary of boundaries) {
        flushCaughtBoundaryError(root, boundary);
      }
    }

    for (const boundary of root.commitIndex) {
      flushCaughtBoundaryError(root, boundary);
    }
  }

  function assertCaughtBoundaryErrorParity(node: F | null): void {
    walkFiberForest(node, (cursor) => {
      const state = fiberErrorBoundaryState(cursor);
      if (state !== null && !state.didReport) {
        throw new Error(
          "Fig internal parity error: a caught boundary error was missing " +
            "from the commit index.",
        );
      }
    });
  }

  function flushCaughtBoundaryError(root: R, node: F): void {
    const state = fiberErrorBoundaryState(node);
    if (state === null || state.didReport) return;

    state.didReport = true;
    if (node.alternate !== null) node.alternate.boundaryState = state;

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
      deleteFiberDataTree(root.current.child);
      abortFiberEffects(root.current);
    }

    if (host.clearContainer !== undefined) {
      removePortalDescendants(root.current.child);
      releaseOutOfBandDescendants(root.current.child);
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
    root.commitEffectPhases = 0;
    root.needsCommitDeletions = false;
    root.committedCaughtErrors.length = 0;
    markRootCompleted(root, NoLanes);
    pendingRoots.delete(root);
  }

  function commitMutationEffects(node: F | null, hidden = false): void {
    let cursor = node;

    while (cursor !== null) {
      const subtreeMutation = (cursor.subtreeFlags & MutationMask) !== 0;

      if ((cursor.flags & MutationMask) === 0 && !subtreeMutation) {
        cursor = cursor.sibling;
        continue;
      }

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

      // Hydration commits are position-sensitive (Activity templates unpack
      // above, Suspense boundaries commit below), so they stay in the walk
      // rather than the host-update queue pass.
      if (
        (cursor.flags & HydrationFlag) !== 0 &&
        (cursor.flags & HostUpdateMask) !== 0 &&
        isHost(cursor)
      ) {
        const hostFiber = cursor;
        commitHostMutation(hostFiber, () => commitUpdate(hostFiber));
        if (hidden) hideHostFiber(hostFiber);
      }

      if ((cursor.flags & AdoptedFlag) === 0 && subtreeMutation) {
        commitMutationEffects(cursor.child, hidden || isHiddenBoundary(cursor));
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

    for (let placed: F | null = firstPlaced; placed !== afterPlaced;) {
      if (placed === null) break;

      const current: F = placed;
      const next: F | null = current.sibling;
      const placedHidden = hidden || isHiddenBoundary(current);
      // Hide (suspending binds) BEFORE inserting so attach paths in the
      // host's insertBefore never run binds on hidden content; hide again
      // after, since a placement update may rewrite the inline style.
      // Preassembled subtrees also pre-hide nested hidden boundaries'
      // content, which never gets a placement of its own.
      if (placedHidden) hidePlacedNode(current);
      if (hasHiddenBoundaries && isPreassembledHostSubtree(current)) {
        hideNestedBoundaryContent(current.child);
      }
      commitHostMutation(current, () => commitPlacement(current, before));
      if (placedHidden) hidePlacedNode(current);
      if (!isPreassembledHostSubtree(current)) {
        commitMutationEffects(current.child, placedHidden);
      } else {
        commitPortalsInPreassembledSubtree(current.child, placedHidden);
      }
      placed = next;
    }

    return afterPlaced;
  }

  // setNodeVisibility keeps a hidden boundary's own subtree untouched, but a
  // FRESH hidden boundary's content was never hidden; hide its children.
  function hidePlacedNode(node: F): void {
    if (isHiddenBoundary(node)) setSubtreeVisibility(node.child, true);
    else setNodeVisibility(node, true);
  }

  function hideNestedBoundaryContent(node: F | null): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if (isHiddenBoundary(cursor)) setSubtreeVisibility(cursor.child, true);
      hideNestedBoundaryContent(cursor.child);
    }
  }

  function commitPortalsInPreassembledSubtree(
    node: F | null,
    hidden: boolean,
  ): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      const cursorHidden = hidden || isHiddenBoundary(cursor);
      if (cursor.tag === PortalTag) {
        if (cursorHidden) setSubtreeVisibility(cursor.child, true);
        if (hasHiddenBoundaries) hideNestedBoundaryContent(cursor.child);
        commitHostMutation(cursor, () => commitPlacement(cursor));
        if (cursorHidden) setNodeVisibility(cursor, true);
        commitMutationEffects(cursor.child, cursorHidden);
      } else {
        commitPortalsInPreassembledSubtree(cursor.child, cursorHidden);
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
      if (node.tag === HostTag && isHoistedFiber(node)) {
        // First commit only: a move keeps the out-of-band instance in place.
        if (node.committedProps === null) acquireHoistedInstance(node);
        markHostCommitted(node);
        markHostSubtreeCommitted(node.child);
        return;
      }
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
    // Re-placing a reused non-host fiber can carry host subtrees that were
    // assembled inside a render that never committed (a captured Suspense
    // primary revealed later). Commit those exactly like a direct host
    // placement would: a live instance whose fiber still claims it never
    // mounted gets re-assembled in place by the next re-render, mutating
    // committed DOM during the render phase.
    visitHostNodes(node, (child) => host.insertBefore(parent, child, before));
    visitHostFibers(node, (child) => {
      if (child.committedProps !== null) return;
      if (child.tag === HostTag && isHoistedFiber(child)) {
        // Hoisted instances live out-of-band (visitHostNodes skips their
        // insertion) but still need first-commit acquisition and marking.
        acquireHoistedInstance(child);
        markHostCommitted(child);
        markHostSubtreeCommitted(child.child);
        return;
      }
      markHostCommitted(child);
      if (isPreassembledHostSubtree(child)) {
        markHostSubtreeCommitted(child.child);
      }
    });
  }

  // Fiber-level companion to visitHostNodes: same traversal and portal
  // boundary, but yields the topmost host fibers themselves (hoisted ones
  // included — callers decide how to commit them).
  function visitHostFibers(node: F, visitor: (child: F) => void): void {
    if (isHost(node)) {
      visitor(node);
      return;
    }

    if (node.tag === PortalTag) return;

    for (let child = node.child; child !== null; child = child.sibling) {
      visitHostFibers(child, visitor);
    }
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
    } else if (node.tag === HostTag && isHoistedFiber(node)) {
      commitHoistedUpdate(node);
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

  function commitHoistedUpdate(node: F): void {
    const hoistedHost = requireHoistedAssetHostConfig();
    const previousProps = previousCommittedProps(node);
    const instance = node.stateNode as Instance;
    const next =
      hoistedHost.updateHoistedInstance(
        instance,
        previousProps,
        node.props,
        assetResourceOwner(node),
      ) ?? instance;

    if (next !== instance) adoptSwappedHoistedInstance(node, next);
  }

  // The host returns a fully updated shared instance. Adopt it on both
  // alternates so subsequent updates and release target the live node.
  function adoptSwappedHoistedInstance(node: F, next: Instance): void {
    node.stateNode = next;
    if (node.alternate !== null) node.alternate.stateNode = next;
  }

  function commitHydratedSuspenseBoundary(node: F): void {
    const boundary = dehydratedSuspenseBoundary(node.alternate);

    if (boundary === null) return;
    host.commitHydratedSuspenseBoundary?.(boundary);
  }

  function commitHydratedActivityBoundary(node: F): void {
    const state = fiberActivityState(node);
    if (state?.dehydrated == null) return;

    requireActivityHydrationHostConfig().commitHydratedActivityBoundary(
      state.dehydrated.boundary,
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
    walkFiberForest(node, (child) => {
      // Hoisted descendants were left out of complete-time assembly; acquire
      // them on the subtree's first commit (moves find committedProps set).
      if (child.committedProps === null && isHoistedFiber(child)) {
        acquireHoistedInstance(child);
      }
      markHostCommitted(child);
    });
  }

  function acquireHoistedInstance(node: F): void {
    const hoistedHost = requireHoistedAssetHostConfig();
    const instance = node.stateNode as Instance;
    const resolved =
      hoistedHost.commitHoistedInstance(
        instance,
        node.props,
        assetResourceOwner(node),
      ) ?? instance;
    if (resolved === instance) return;

    // The identity resolved to a shared live instance (e.g. inserted while
    // this render was suspended); drop the stale duplicate.
    adoptSwappedHoistedInstance(node, resolved);
  }

  // Runs before the mutation walk, and owns only steady-state updates:
  // hydration commits stay in the walk (an Activity template must unpack
  // before its hydrated children bind, and Suspense boundary commits follow
  // their instances), and first commits stay with the placement/assembly
  // paths (committing an update first would set committedProps and defeat
  // hoisted acquisition and shouldCommitPlacementUpdate). Updates inside
  // subtrees the walk will place apply while those nodes are still at their
  // old position (or detached); the insertion carries them over.
  function commitHostUpdates(root: R): void {
    for (const cursor of root.commitIndex) {
      if ((cursor.flags & HostUpdateMask) === 0 || !isHost(cursor)) continue;
      if ((cursor.flags & (HydrationFlag | PlacementFlag)) !== 0) continue;
      // First commits belong to placement/assembly — except text, whose
      // first "update" is how hydration applies a differing value.
      if (cursor.committedProps === null && cursor.tag !== TextTag) continue;
      commitHostMutation(cursor, () => commitUpdate(cursor));
      // Prerendered mutations inside hidden trees must stay hidden.
      if (hasHiddenBoundaries && isInsideHiddenBoundary(cursor)) {
        hideHostFiber(cursor);
      }
      // Own-fiber update bits never reach subtreeFlags, so the flag-clearing
      // walk cannot be relied on to reach them; the pass owns their cleanup.
      cursor.flags &= ~HostUpdateMask;
    }
  }

  function assertHostUpdateCommitParity(node: F | null): void {
    walkFiberForest(node, (cursor) => {
      if (
        (cursor.flags & HostUpdateMask) !== 0 &&
        (cursor.flags & (HydrationFlag | PlacementFlag)) === 0 &&
        (cursor.committedProps !== null || cursor.tag === TextTag) &&
        isHost(cursor)
      ) {
        throw new Error(
          "Fig internal parity error: a host fiber with pending updates " +
            "was missing from the commit index.",
        );
      }

      return (cursor.flags & AdoptedFlag) === 0;
    });
  }

  function commitDeletions(root: R): void {
    const store = root.dataStore;
    for (const cursor of root.commitIndex) {
      if (cursor.deletions === null) continue;
      const parent = isHostParent(cursor)
        ? hostParentFor(cursor)
        : hostParent(cursor);
      for (const child of cursor.deletions) {
        // One walk, bounded to the deleted subtree: a deletion entry's old
        // sibling pointers still reference kept fibers whose hook state is
        // shared with the live generation, so a forest walk here would tear
        // down hooks that are still mounted.
        walkFiberSubtree(child, (deleted) => {
          deleteFiberDataOwner(deleted, store);
          abortFiberHooks(deleted, false);
        });
        // Deletion is the one event that invalidates a committed fiber
        // identity; record it at the source by severing the subtree root's
        // upward links (both generations die together). Every return chain
        // out of the deleted subtree passes through one of the root's two
        // generations, so anything that later schedules through a deleted
        // fiber — a late suspense retry, a setState from a stale closure —
        // fails root lookup and no-ops instead of marking phantom lanes.
        // Severing waits until here because the teardown above still
        // resolves roots through these chains.
        child.return = null;
        if (child.alternate !== null) child.alternate.return = null;
        remove(child, parent);
      }
      cursor.deletions = null;
    }
  }

  function assertDeletionCommitParity(node: F): void {
    walkFiberSubtree(node, (cursor) => {
      if (cursor.deletions !== null) {
        throw new Error(
          "Fig internal parity error: a fiber with pending deletions was " +
            "missing from the commit index.",
        );
      }

      return (
        (cursor.flags & AdoptedFlag) === 0 &&
        (cursor.subtreeFlags & DeletionFlag) !== 0
      );
    });
  }

  function commitDataDependencies(root: R): void {
    for (const cursor of root.commitIndex) {
      if (!cursor.dataDependenciesDirty) continue;
      root.dataStore.commitDataDependencies(cursor, cursor.alternate);
      cursor.dataDependenciesDirty = false;
      if (cursor.alternate !== null)
        cursor.alternate.dataDependenciesDirty = false;
    }
  }

  function commitAssetResourceUpdates(root: R): void {
    if (host.commitAssetResources === undefined) return;

    for (const cursor of root.commitIndex) {
      if ((cursor.flags & AssetFlag) === 0) continue;
      commitHostMutation(cursor, () =>
        host.commitAssetResources?.(
          (cursor.committedProps?.assets as FigAssetResourceList | undefined) ??
            null,
          cursor.props.assets as FigAssetResourceList,
          assetResourceOwner(cursor),
        ),
      );
      cursor.committedProps = cursor.props;
      if (cursor.alternate !== null) {
        cursor.alternate.committedProps = cursor.props;
      }
      cursor.flags &= ~AssetFlag;
    }
  }

  function assertAssetResourceCommitParity(node: F | null): void {
    walkFiberForest(node, (cursor) => {
      if ((cursor.flags & AssetFlag) !== 0) {
        throw new Error(
          "Fig internal parity error: an Assets fiber with pending resource " +
            "work was missing from the commit index.",
        );
      }
      return (cursor.flags & AdoptedFlag) === 0;
    });
  }

  // Every host fiber that reaches the DOM through this commit — its own
  // placement or an ancestor's subtree insertion — must leave the mutation
  // phase marked committed. A live instance whose fiber still claims it
  // never mounted is the poison behind render-phase re-assembly of
  // committed DOM (in-place-reuse trap: insertion paths that skip commit
  // marking), so fail loudly at the commit that minted it.
  function assertPlacedHostCommitParity(node: F | null, placed: boolean): void {
    for (let child = node; child !== null; child = child.sibling) {
      const childPlaced = placed || (child.flags & PlacementFlag) !== 0;
      if (childPlaced && isHost(child) && child.committedProps === null) {
        throw new Error(
          "Fig internal parity error: a placed host fiber has no committed " +
            "props after the mutation phase (a subtree insertion skipped " +
            "commit marking).",
        );
      }
      if (childPlaced || (child.subtreeFlags & PlacementFlag) !== 0) {
        assertPlacedHostCommitParity(child.child, childPlaced);
      }
    }
  }

  function assertDataDependencyCommitParity(node: F | null): void {
    walkFiberForest(node, (cursor) => {
      if (cursor.dataDependenciesDirty) {
        throw new Error(
          "Fig internal parity error: a fiber with dirty data dependencies " +
            "was missing from the commit index.",
        );
      }

      return (cursor.flags & AdoptedFlag) === 0;
    });
  }

  function deleteFiberDataTree(node: F): void {
    const store = rootOf(node).dataStore;
    walkFiberForest(node, (cursor) => {
      deleteFiberDataOwner(cursor, store);
    });
  }

  function deleteFiberDataOwner(node: F, store: R["dataStore"]): void {
    store.releaseDataOwner(node);
    if (node.alternate !== null) store.releaseDataOwner(node.alternate);
    // A hidden boundary removed from the tree stops counting toward
    // `hasHiddenBoundaries`; both generations share the one state object.
    const state = fiberActivityState(node);
    if (state !== null) hiddenStates.delete(state);
  }

  function dehydratedActivityBoundary(node: F): Instance | null {
    return node.tag === ActivityTag
      ? (fiberActivityState(node)?.dehydrated?.boundary ?? null)
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

    if (node.tag === AssetsTag) releaseAssetResources(node);

    if (node.tag === HostTag && isHoistedFiber(node)) {
      if (node.committedProps !== null) {
        requireHoistedAssetHostConfig().removeHoistedInstance(
          node.stateNode as Instance,
          assetResourceOwner(node),
        );
      }
      return;
    }

    if (isHost(node)) {
      removePortalDescendants(node.child);
      releaseOutOfBandDescendants(node.child);
      host.removeChild(parent, hostNode(node));
      return;
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      remove(child, parent);
    }
  }

  // Hoisted instances and declarative assets are not DOM descendants of the
  // removed host, so the top-node removal above never reaches them; release
  // them explicitly.
  function releaseOutOfBandDescendants(node: F | null): void {
    if (
      host.resolveHoistedInstance === undefined &&
      host.commitAssetResources === undefined
    ) {
      return;
    }

    for (let child = node; child !== null; child = child.sibling) {
      if (child.tag === PortalTag) continue;

      if (child.tag === AssetsTag) releaseAssetResources(child);

      if (child.tag === HostTag && isHoistedFiber(child)) {
        if (child.committedProps !== null && child.stateNode !== null) {
          requireHoistedAssetHostConfig().removeHoistedInstance(
            child.stateNode as Instance,
            assetResourceOwner(child),
          );
        }
        continue;
      }

      releaseOutOfBandDescendants(child.child);
    }
  }

  function releaseAssetResources(node: F): void {
    if (
      node.tag !== AssetsTag ||
      node.committedProps === null ||
      host.commitAssetResources === undefined
    ) {
      return;
    }
    host.commitAssetResources(
      node.committedProps.assets as FigAssetResourceList,
      null,
      assetResourceOwner(node),
    );
    node.committedProps = null;
    if (node.alternate !== null) node.alternate.committedProps = null;
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
      // Both callers insert host nodes into a position; hoisted instances
      // live out-of-band and must never be moved to a fiber position.
      if (node.tag === HostTag && isHoistedFiber(node)) return;
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

  function hostAncestorTypes(node: F): string[] {
    const ancestors: string[] = [];

    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (parent.tag === HostTag) {
        ancestors.push(String(parent.type));
        continue;
      }

      // Fiber ancestry ends at portals and roots; seed the container's own
      // tag so nesting against the render target is still validated.
      if (parent.tag === PortalTag || parent.tag === RootTag) {
        const container = host.containerType?.(hostParentFor(parent));
        if (container != null) ancestors.push(container);
        break;
      }
    }

    return ancestors;
  }

  function hostSibling(node: F): HostNode<Instance, TextInstance> | null {
    // Root hydration recovery removes every existing host sibling before
    // placement. Keep the flag live through mutations so none of those
    // detached nodes can become an insertion anchor.
    if (rootOf(node).clearContainerBeforeCommit) return null;

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

      if ((cursor.flags & PlacementFlag) === 0 && !isHoistedFiber(cursor)) {
        return hostNode(cursor);
      }
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
    const state = fiberSuspenseState(node);
    return state?.kind === "dehydrated" ? state.boundary : null;
  }

  function fiberSuspenseState(
    node: F | null | undefined,
  ): SuspenseState<Container, Instance, TextInstance> | null {
    return node?.tag === SuspenseTag
      ? (node.boundaryState as SuspenseState<
          Container,
          Instance,
          TextInstance
        > | null)
      : null;
  }

  function fiberErrorBoundaryState(
    node: F | null | undefined,
  ): ErrorBoundaryState | null {
    return node?.tag === ErrorBoundaryTag
      ? (node.boundaryState as ErrorBoundaryState | null)
      : null;
  }

  function fiberActivityState(
    node: F | null | undefined,
  ): ActivityState<Instance> | null {
    return node?.tag === ActivityTag
      ? (node.boundaryState as ActivityState<Instance> | null)
      : null;
  }

  function ensureFiberActivityState(node: F): ActivityState<Instance> {
    const current = fiberActivityState(node);
    if (current !== null) return current;

    const state: ActivityState<Instance> = { hidden: false, dehydrated: null };
    node.boundaryState = state;
    return state;
  }

  function scheduleFiber(node: F, lane: Lane): void {
    markLanes(node, lane);
    const root = scheduleParentPath(node.return, lane);
    const alternateRoot = scheduleParentPath(
      node.alternate?.return ?? null,
      lane,
    );
    const scheduledRoot = root ?? alternateRoot;
    if (scheduledRoot === null) return;

    markRootPending(scheduledRoot, lane);
    scheduleOrBatchRoot(scheduledRoot);
  }

  function scheduleParentPath(parent: F | null, lane: Lane): R | null {
    for (; parent !== null; parent = parent.return) {
      markChildLanes(parent, lane);

      if (parent.tag === RootTag) {
        return parent.stateNode as R;
      }
    }

    return null;
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
      if (parent.tag === SuspenseTag && fiberSuspenseState(parent) === null) {
        return parent;
      }
    }

    return null;
  }

  function findErrorBoundary(node: F): F | null {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (
        parent.tag === ErrorBoundaryTag &&
        fiberErrorBoundaryState(parent) === null
      ) {
        return parent;
      }
    }

    return null;
  }

  function captureSuspenseBoundary(boundary: F, thenable: Thenable): F | null {
    const root = rootOf(boundary);
    const lanes = root.renderLanes;
    // Two pings per suspension. The root ping is identity-free: if this
    // render never commits (preserved suspension, restart, interruption),
    // the resolved thenable revives the suspended lanes at the root, and it
    // no-ops once the lanes committed (markRootPinged masks by
    // suspendedLanes). The boundary retry is recorded here but attached only
    // at commit, to the fiber identity the commit blessed.
    attachPing(root, thenable, lanes);
    root.pendingSuspenseRetries.push({ boundary, thenable, lanes });
    rollbackCommitIndex(root.commitIndex, boundary.commitIndexCheckpoint);
    // The boundary's own deletions (e.g. the committed fallback recorded by
    // the reveal path) belong to the boundary, not its discarded subtree;
    // requeue them. Paths that discard them null boundary.deletions, which
    // leaves this entry inert.
    if (boundary.deletions !== null)
      recordCommitWork(root.commitIndex, boundary);

    const dehydrated = fiberSuspenseState(boundary.alternate);
    if (
      root.hydratingSuspenseBoundary === boundary &&
      dehydrated?.kind === "dehydrated"
    ) {
      // Hydrating this boundary suspended. Abandon the attempt and stay
      // dehydrated so the server-rendered content survives; the retry
      // recorded above re-attempts hydration once the thenable settles, so
      // commit-time dehydrated retry scheduling must skip the boundary until
      // then.
      leaveSuspenseHydration(root, boundary, dehydrated.boundary);
      boundary.boundaryState = dehydrated;
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

    const currentPrimary = suspensePrimaryFiber(boundary.alternate);
    if (currentPrimary !== null) {
      boundary.boundaryState = { kind: "fallback", primaryChild: null };
      boundary.deletions = null;
      restoreConsumedPendingQueuesForRetry(
        root,
        boundary.suspenseQueueStart ?? root.consumedPendingQueues.length,
      );
      hasHiddenBoundaries = true;
      const primary = suspensePrimaryWorkInProgress(
        boundary,
        currentPrimary,
        "hidden",
      );
      primary.child = cloneSuspendedPrimary(currentPrimary.child, primary);
      primary.flags |= VisibilityFlag;
      primary.memoizedProps = primary.props;
      // The hidden primary is committed but not begun/completed this pass, so
      // its lanes are not recomputed — clear them (and the boundary will not see
      // OffscreenLane work blocked behind the still-suspended boundary).
      primary.lanes = NoLanes;
      primary.childLanes = NoLanes;
      boundary.child = primary;

      const fallback = suspenseFallbackWorkInProgress(
        boundary,
        currentPrimary.sibling,
        1,
      );
      primary.sibling = fallback;
      return fallback;
    }

    // There is no committed primary on an initial suspension. Keep the partial
    // render only as retry input; committing it hidden would publish an
    // incomplete host tree.
    boundary.boundaryState = {
      kind: "fallback",
      primaryChild:
        boundary.child?.tag === ActivityTag && boundary.child.type === null
          ? boundary.child.child
          : boundary.child,
    };
    const fallback = suspenseFallbackWorkInProgress(boundary, null, 0);
    boundary.child = fallback;
    return fallback;
  }

  function captureErrorBoundary(
    boundary: F,
    error: unknown,
    source: F,
  ): F | null {
    const root = rootOf(boundary);
    rollbackCommitIndex(root.commitIndex, boundary.commitIndexCheckpoint);
    recordCommitWork(root.commitIndex, boundary);
    const state = createErrorBoundaryState(error, source);
    boundary.boundaryState = state;
    reconcileCurrentChildren(boundary, errorBoundaryFallback(boundary, state));
    return boundary.child ?? completeUnit(boundary);
  }

  function captureCommittedErrorBoundary(
    boundary: F,
    error: unknown,
    source: F,
  ): void {
    rootOf(boundary).committedCaughtErrors.push(boundary);
    const state = createErrorBoundaryState(error, source);
    boundary.boundaryState = state;
    if (boundary.alternate !== null) boundary.alternate.boundaryState = state;
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
      fiberSuspenseState(boundary.alternate) === null &&
      isTransitionOrDeferredRender(root)
    );
  }

  // Boundary retries attach here, after the tree flipped: the recorded fiber
  // is in the committed tree by construction, so no tree-membership question
  // ever arises. A retry that fires after the boundary is deleted no-ops in
  // scheduleFiber, because deletion teardown severs the deleted subtree's
  // upward links and root lookup finds nothing.
  function attachCommittedSuspenseRetries(
    root: R,
    retries: PendingSuspenseRetry<Container, Instance, TextInstance>[],
  ): void {
    for (const { boundary, thenable, lanes } of retries) {
      // A boundary that re-suspends on a still-pending thenable in a later
      // commit would otherwise stack duplicate listeners; one per conceptual
      // boundary (either generation) is enough.
      let attached = root.attachedSuspenseRetries.get(thenable);
      if (attached === undefined) {
        attached = new WeakSet();
        root.attachedSuspenseRetries.set(thenable, attached);
      }
      if (
        attached.has(boundary) ||
        (boundary.alternate !== null && attached.has(boundary.alternate))
      ) {
        continue;
      }
      attached.add(boundary);

      const retry = () => scheduleFiber(boundary, suspenseRetryLane(lanes));
      thenable.then(retry, retry);
    }
  }

  // Context propagation is lazy: providers push new values without walking
  // their subtree, so a subtree about to be skipped is the only place a stale
  // consumer could get stranded. Every skip point (clean-childLanes bailout)
  // checks the providers above it and marks the consumers it is about to skip.
  // Consumers that are begun anyway are covered by canBailout's memoized
  // dependency check, so no eager walk is needed. Returns whether the node's
  // childLanes now intersect the render lanes; the early-false paths rely on
  // the caller only asking when childLanes were already clean.
  function lazilyPropagateParentContextChanges(node: F, root: R): boolean {
    if ((node.flags & ContextPropagationFlag) !== 0) return false;

    const contexts = changedParentContexts(node);
    node.flags |= ContextPropagationFlag;
    if (contexts === null) return false;

    const current = node.alternate;
    if (current === null) return false;

    for (const context of contexts) {
      if (!contextListIncludes(current.contextSubtreeDependencies, context)) {
        continue;
      }

      for (let child = current.child; child !== null; child = child.sibling) {
        markContextConsumers(child, current, context, root.renderLanes);
      }
    }

    return includesSomeLane(node.childLanes, root.renderLanes);
  }

  function changedParentContexts(node: F): FigContext<unknown>[] | null {
    let seen =
      node.tag === ContextProviderTag
        ? [node.type as FigContext<unknown>]
        : null;
    let changed: FigContext<unknown>[] | null = null;

    for (let parent = node.return; parent !== null; parent = parent.return) {
      if ((parent.flags & ContextPropagationFlag) !== 0) break;
      if (parent.tag !== ContextProviderTag) continue;

      const context = parent.type as FigContext<unknown>;
      if (contextListIncludes(seen, context)) continue;
      seen = appendContext(seen, context);
      if (changedContextProvider(parent)) {
        changed = appendContext(changed, context);
      }
    }

    return changed;
  }

  function markContextConsumers(
    node: F,
    propagationRoot: F,
    context: FigContext<unknown>,
    lanes: Lanes,
  ): void {
    if (node.tag === ContextProviderTag && node.type === context) {
      return;
    }

    if (contextDependency(node, context) !== null) {
      markLanes(node, lanes);
      markParentPath(node, propagationRoot, lanes);
    }

    if (!contextListIncludes(node.contextSubtreeDependencies, context)) return;

    for (let child = node.child; child !== null; child = child.sibling) {
      markContextConsumers(child, propagationRoot, context, lanes);
    }
  }

  // Marks childLanes up to and including stopAt: stopAt is the skip point
  // whose childLanes gate whether its subtree is adopted or descended into.
  function markParentPath(node: F, stopAt: F, lanes: Lanes): void {
    for (
      let parent = node.return;
      parent !== null && parent !== stopAt;
      parent = parent.return
    ) {
      markChildLanes(parent, lanes);
    }

    markChildLanes(stopAt, lanes);
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

  function markSubtreeFlag(node: F, flag: Flag): void {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      parent.subtreeFlags |= flag;
    }
  }

  function createWorkInProgress(current: F, props: Props): F {
    const next =
      current.alternate ??
      fiber(current.tag, current.type, current.key, props, current.stateNode);

    next.props = props;
    next.memoizedProps = current.memoizedProps;
    next.committedProps = current.committedProps;
    next.assetResourceOwner = current.assetResourceOwner;
    next.memoizedState = current.memoizedState;
    next.stateNode = current.stateNode;
    next.return = current.return;
    next.child = null;
    next.sibling = null;
    next.index = current.index;
    // Exactly the hoisted bit survives the clone, in both directions:
    // - HoistedStaticFlag MUST carry. It is set once, when the instance is
    //   resolved, and never re-derived; a clone without it would misroute
    //   commit work — most dangerously deletion, where host.removeChild at
    //   the fiber position targets an instance that lives in <head>
    //   (NotFoundError in a real DOM).
    // - ViewTransitionStaticFlag MUST NOT carry. complete() re-derives it
    //   for every fiber a render visits, so carrying it only matters for
    //   clones that never complete (cloneSuspendedPrimary's captured hidden
    //   trees): their stale bit would survive into the hidden Activity's
    //   subtree summary and advertise view-transition boundaries in commits
    //   that have no live view-transition work.
    next.flags = current.flags & HoistedStaticFlag;
    next.subtreeFlags = NoFlags;
    next.deletions = null;
    next.lanes = current.lanes;
    next.childLanes = current.childLanes;
    next.effects = null;
    next.contextDependencies = current.contextDependencies;
    next.contextSubtreeDependencies = current.contextSubtreeDependencies;
    next.dataDependenciesDirty = false;
    next.boundaryState = current.boundaryState;
    next.hiddenState = null;
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

  function fiberFrom(child: NormalizedChild): F | null {
    if (typeof child === "string") {
      return fiber(TextTag, null, null, { nodeValue: child }, null);
    }

    if (isPortal(child)) {
      return fiber(PortalTag, null, child.key, portalProps(child), null);
    }

    if (isValidElement(child)) {
      return fiber(tagFor(child), child.type, child.key, child.props, null);
    }

    if (isThenable(child)) {
      return fiber(ThenableTag, null, null, { thenable: child }, null);
    }

    return null;
  }

  function portalTarget(node: F): Parent<Container, Instance> {
    return node.props.target as Parent<Container, Instance>;
  }

  function fiber(
    tag: Tag,
    type: FiberType,
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
      subtreeFlags: NoFlags,
      deletions: null,
      lanes: NoLanes,
      childLanes: NoLanes,
      effects: null,
      contextDependencies: null,
      contextSubtreeDependencies: null,
      dataDependenciesDirty: false,
      assetResourceOwner: null,
      boundaryState: null,
      hiddenState: null,
    };
  }

  function assetResourceOwner(node: F): AssetResourceOwner {
    // Lifecycle walks can retain either fiber generation. Normalize the
    // identity on every access so acquisition and release cannot disagree.
    const owner =
      node.assetResourceOwner ??
      node.alternate?.assetResourceOwner ??
      ({} as AssetResourceOwner);
    node.assetResourceOwner = owner;
    if (node.alternate !== null) node.alternate.assetResourceOwner = owner;
    return owner;
  }

  function rootOf(node: F): R {
    const root = rootOfOrNull(node);
    if (root === null) throw new Error("Could not find a root for fiber.");
    return root;
  }

  // Deletion teardown severs return pointers, so fibers held past unmount
  // (transition starters, stale closures) legitimately have no root. Paths
  // reachable from user code after unmount take this form; render- and
  // commit-time paths keep the throwing rootOf invariant.
  function rootOfOrNull(node: F): R | null {
    for (let parent: F | null = node; parent !== null; parent = parent.return) {
      if (parent.tag === RootTag) return parent.stateNode as R;
    }

    return null;
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
      case ViewTransitionTag:
        return "ViewTransition";
      case PortalTag:
        return "Portal";
      case AssetsTag:
        return "Assets";
      default:
        return null;
    }
  }

  return {
    batchedUpdates,
    createRoot,
    hydrateRoot,
    hydrateTarget,
    flushSync,
    installCommitCoordinator,
    scheduleRefresh,
  };

  // Re-render every mounted instance of a changed component family. Updated
  // families re-render in place (hook state preserved); stale families (hook
  // signature changed) remount via their parent. The refresh runtime swaps each
  // family's `current` before calling this.
  // Each refresh function wraps its whole body in a block-form dev gate
  // (not an early return: esbuild only drops the bodies — and with them the
  // machinery — via parse-time branch elimination) so production builds ship
  // empty stubs.
  function scheduleRefresh(update: RefreshUpdate): void {
    if (__DEV__) {
      if (!hasRefreshHandler() || mountedRoots.size === 0) return;

      runWithStaleRefreshFamilies(update.staleFamilies, () => {
        flushSync(() => {
          for (const root of mountedRoots) {
            scheduleFamilyRefresh(root.current.child, update);
          }
        });
      });
    }
  }

  function scheduleFamilyRefresh(node: F | null, update: RefreshUpdate): void {
    if (__DEV__) {
      if (node === null) return;

      if (node.tag === FunctionTag && hasRefreshHandler()) {
        const family = refreshFamilyFor(node.type);
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
  }

  // A stale component must drop its hook state. Re-render its parent so the
  // child reconciles as an incompatible type and remounts; for a top-level
  // component re-render the whole root.
  function remountForRefresh(node: F): void {
    if (__DEV__) {
      const parent = node.return;
      if (parent === null || parent.tag === RootTag) {
        const root = rootOf(node);
        updateRoot(root, root.element);
      } else {
        scheduleFiber(parent, SyncLane);
      }
    }
  }

  function findDehydratedSuspenseBoundaryForTarget(
    node: F | null,
    target: unknown,
  ): F | null {
    if (node === null || host.isTargetWithinSuspenseBoundary === undefined) {
      return null;
    }

    const state = fiberSuspenseState(node);
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

  function isHiddenBoundary(node: F): boolean {
    return node.tag === ActivityTag && activityHidden(node.props);
  }

  function requireActivityHostConfig(): ActivityVisibilityHostConfig {
    if (activityHostConfig !== null) return activityHostConfig;

    if (
      host.hideInstance === undefined ||
      host.unhideInstance === undefined ||
      host.hideTextInstance === undefined ||
      host.unhideTextInstance === undefined
    ) {
      throw new Error("Activity is not supported by this renderer.");
    }

    activityHostConfig = host as ActivityVisibilityHostConfig;
    return activityHostConfig;
  }

  function commitHiddenBoundaryVisibility(
    node: F | null,
    hidden = false,
  ): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if ((cursor.flags & AdoptedFlag) !== 0) continue;
      const subtreeVisibility = (cursor.subtreeFlags & VisibilityFlag) !== 0;

      if ((cursor.flags & VisibilityFlag) === 0 && !subtreeVisibility) {
        continue;
      }

      const boundary = cursor.tag === ActivityTag;
      const boundaryHidden = boundary && activityHidden(cursor.props);

      if (boundary && (cursor.flags & VisibilityFlag) !== 0) {
        const effectiveHidden = hidden || boundaryHidden;
        const state = fiberActivityState(cursor);
        if (state !== null) {
          state.hidden = effectiveHidden;
          if (effectiveHidden) hiddenStates.add(state);
          else hiddenStates.delete(state);
        }
        setSubtreeVisibility(cursor.child, effectiveHidden);
        if (effectiveHidden && cursor.child !== null)
          abortFiberEffects(cursor.child, true);
        if (
          !effectiveHidden &&
          includesSomeLane(cursor.childLanes, OffscreenLane)
        ) {
          // Pending hidden work upgrades to prompt processing on reveal.
          const root = rootOf(cursor);
          markRootPending(root, DefaultLane);
          markRootEntangled(root, DefaultLane | OffscreenLane);
          scheduleOrBatchRoot(root);
        }
      }

      if (subtreeVisibility) {
        commitHiddenBoundaryVisibility(cursor.child, hidden || boundaryHidden);
      }
    }
  }

  function setSubtreeVisibility(node: F | null, hidden: boolean): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      setNodeVisibility(cursor, hidden);
    }
  }

  function setNodeVisibility(cursor: F, hidden: boolean): void {
    // Subtrees hidden by their own boundary keep their visibility.
    if (isHiddenBoundary(cursor)) return;

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

    setSubtreeVisibility(cursor.child, hidden);
  }

  function hideHostFiber(node: F): void {
    const activityHost = requireActivityHostConfig();
    if (node.tag === HostTag) {
      activityHost.hideInstance(node.stateNode as Instance);
    } else {
      activityHost.hideTextInstance(node.stateNode as TextInstance);
    }
  }

  function armRevealedHiddenBoundaries(node: F | null): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if ((cursor.flags & AdoptedFlag) !== 0) continue;
      const subtreeVisibility = (cursor.subtreeFlags & VisibilityFlag) !== 0;

      if ((cursor.flags & VisibilityFlag) === 0 && !subtreeVisibility) {
        continue;
      }

      if (
        cursor.tag === ActivityTag &&
        (cursor.flags & VisibilityFlag) !== 0 &&
        !activityHidden(cursor.props) &&
        cursor.child !== null
      ) {
        armDeferredEffects(cursor.child);
      }

      if (subtreeVisibility) armRevealedHiddenBoundaries(cursor.child);
    }
  }

  // Re-arms effects that were deferred or aborted while hidden so the
  // regular commit phases run them in order during the reveal commit.
  function armDeferredEffects(node: F): void {
    visitFiberHooks(node, (owner, hook) => {
      if (hook.kind === StableEventHook) {
        const state = hook.memoizedState as StableEventState;
        const instance = state.instance;
        instance.handler = state.next;
        instance.live = true;
        return;
      }

      if (!isEffectHook(hook.kind)) return;

      const effect = hook.memoizedState as Effect;
      if (effect.controller !== null) return;

      const effects = (owner.effects ??= []);
      if (!effects.includes(effect)) effects.push(effect);
      const root = rootOf(owner);
      recordCommitWork(root.commitIndex, owner, EffectFlag);
      markSubtreeFlag(owner, EffectFlag);
      markCommitEffectPhase(root, effect.phase);
      // Re-armed owners that did not re-render are not in the commit index
      // yet; the arming pass runs before every effect pass consumes it.
    });
  }

  function commitLiveHookInstances(root: R): void {
    for (const owner of root.commitIndex) {
      for (let hook = owner.memoizedState; hook !== null; hook = hook.next) {
        commitLiveHookInstance(owner, hook);
      }
    }
  }

  function commitLiveHookInstance(owner: F, hook: Hook): void {
    if (isStableEventHook(hook)) {
      const instance = hook.memoizedState.instance;
      instance.handler = hook.memoizedState.next;
      instance.live = !hasHiddenBoundaries || !isInsideHiddenBoundary(owner);
    }

    if (hook.kind === ActionStateHook) {
      const state = hook.memoizedState as ActionState<unknown, unknown[]>;
      state.instance.action = state.action;
      state.instance.value = state.value;
    }
  }

  // Bailed-out (cloned) fibers share their hook state objects with the last
  // rendered generation, so their instances already hold the published
  // values; the queue therefore only carries rendered fibers. This walk
  // proves that assumption on every dev commit.
  function assertLiveHookInstanceParity(node: F | null): void {
    visitRenderedFiberHooks(node, (owner, hook) => {
      if (isStableEventHook(hook)) {
        const instance = hook.memoizedState.instance;
        if (
          instance.handler !== hook.memoizedState.next ||
          instance.live !==
            (!hasHiddenBoundaries || !isInsideHiddenBoundary(owner))
        ) {
          throw new Error(
            "Fig internal parity error: a stable-event hook was not " +
              "published by the commit index.",
          );
        }
      }

      if (hook.kind === ActionStateHook) {
        const state = hook.memoizedState as ActionState<unknown, unknown[]>;
        if (
          state.instance.action !== state.action ||
          state.instance.value !== state.value
        ) {
          throw new Error(
            "Fig internal parity error: an action-state hook was not " +
              "published by the commit index.",
          );
        }
      }
    });
  }

  function isInsideHiddenBoundary(node: F): boolean {
    for (let parent = node.return; parent !== null; parent = parent.return) {
      if (isHiddenBoundary(parent)) return true;
    }

    return false;
  }

  function isStableEventHook(hook: Hook): hook is Hook<StableEventState> {
    return hook.kind === StableEventHook;
  }

  function commitExternalStores(root: R): void {
    for (const cursor of root.commitIndex) {
      if ((cursor.flags & StoreConsistencyFlag) === 0) continue;
      // Subscriptions under hidden boundaries are deferred until reveal.
      if (hasHiddenBoundaries && isInsideHiddenBoundary(cursor)) continue;
      for (let hook = cursor.memoizedState; hook !== null; hook = hook.next) {
        if (isExternalStoreHook(hook))
          commitExternalStore(root, cursor, hook.memoizedState);
      }
    }
  }

  function assertExternalStoreCommitParity(node: F | null): void {
    walkFiberForest(node, (cursor) => {
      if ((cursor.flags & AdoptedFlag) !== 0) return false;

      if ((cursor.flags & StoreConsistencyFlag) !== 0) {
        for (let hook = cursor.memoizedState; hook !== null; hook = hook.next) {
          if (!isExternalStoreHook(hook)) continue;
          const state = hook.memoizedState;
          const instance = state.instance;
          if (
            instance.committedSubscribe !== state.subscribe ||
            instance.getSnapshot !== state.getSnapshot ||
            instance.owner !== cursor ||
            !Object.is(instance.value, state.value)
          ) {
            throw new Error(
              "Fig internal parity error: an external-store hook was not " +
                "committed by the commit index.",
            );
          }
        }
      }

      return (
        !isHiddenBoundary(cursor) &&
        (cursor.subtreeFlags & StoreConsistencyFlag) !== 0
      );
    });
  }

  function commitExternalStore(
    root: R,
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
    root.externalStores.add(instance);
    instance.unsubscribe ??= state.subscribe(() => {
      scheduleExternalStoreIfChanged(
        instance.owner,
        instance,
        requestExternalStoreUpdateLane(),
      );
    });
    scheduleExternalStoreIfChanged(instance.owner, instance, SyncLane);
  }

  function scheduleExternalStoreIfChanged(
    owner: F | null,
    instance: ExternalStoreInstance<unknown, F>,
    lane: Lane,
  ): void {
    if (owner === null) return;

    const latestValue = instance.getSnapshot();
    if (!Object.is(latestValue, instance.value)) scheduleFiber(owner, lane);
  }

  function requestExternalStoreUpdateLane(): Lane {
    const lane = requestUpdateLane();
    return lane === DefaultLane ? SyncLane : lane;
  }

  function commitEffects(root: R, node: F | null, phase: EffectPhase): void {
    const mask = 1 << phase;
    if ((root.commitEffectPhases & mask) === 0) return;

    let executed = 0;
    const runEffects = () => {
      for (const owner of root.commitIndex) {
        const effects = owner.effects;
        if (effects === null) continue;
        // Effects under hidden boundaries stay deferred until reveal.
        if (hasHiddenBoundaries && isInsideHiddenBoundary(owner)) continue;
        for (const effect of effects) {
          if (effect.phase !== phase) continue;
          if (__DEV__) executed += 1;
          runCommitEffect(effect, phase);
        }
      }
    };

    if (phase === BeforePaintEffect) {
      runWithPriority(SyncLane, runEffects);
    } else {
      runEffects();
    }
    root.commitEffectPhases &= ~mask;

    if (__DEV__) {
      let expected = 0;
      visitEffects(node, (effect) => {
        if (effect.phase === phase) expected += 1;
      });
      if (executed !== expected) {
        throw new Error(
          "Fig internal parity error: the commit index executed " +
            `${executed} ${hookKindNames[phase]} effect(s) where the tree ` +
            `walk found ${expected}.`,
        );
      }
    }
  }

  function runCommitEffect(effect: Effect, phase: EffectPhase): void {
    const previousPhase = currentCommitEffectPhase;
    currentCommitEffectPhase = phase;
    try {
      runEffect(effect);
    } finally {
      currentCommitEffectPhase = previousPhase;
    }
  }

  function collectReactiveEffects(root: R, node: F | null): void {
    walkFiberForest(node, (cursor) => {
      for (const effect of cursor.effects ?? []) {
        if (effect.phase === ReactiveEffect)
          root.pendingReactiveEffects.push(effect);
      }

      cursor.effects = null;
      const adopted = (cursor.flags & AdoptedFlag) !== 0;
      const subtreeFlags = cursor.subtreeFlags;
      // The last flag consumer in the commit clears them (static facts
      // excepted), so committed trees stay flag-clean and adopted subtrees
      // never expose stale commit state.
      clearTransientFlags(cursor);
      if (adopted) return false;
      if (isHiddenBoundary(cursor)) {
        if (subtreeFlags !== NoFlags) clearHiddenSubtreeFlags(cursor.child);
        return false;
      }
      return (subtreeFlags & ~StaticFlagsMask) !== NoFlags;
    });
  }

  // Hidden subtrees keep their deferred fiber.effects for reveal, but their
  // flags must still be cleared to keep committed trees flag-clean. Reveal
  // arming depends on those effect arrays surviving every commit while
  // hidden; no walk may null them below a hidden boundary.
  function clearHiddenSubtreeFlags(node: F | null): void {
    walkFiberForest(node, (cursor) => {
      const adopted = (cursor.flags & AdoptedFlag) !== 0;
      const subtreeFlags = cursor.subtreeFlags;
      clearTransientFlags(cursor);
      return !adopted && (subtreeFlags & ~StaticFlagsMask) !== NoFlags;
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
      performReactiveEffects(root);
    });
  }

  // The standalone reactive flush has no performRoot frame around its
  // scheduler tick, so uncaught effect errors (handleEffectError rethrows
  // when no ancestor boundary exists) are routed here exactly like
  // performRoot's catch: clear the committed UI, report to onUncaughtError,
  // and keep the error out of the scheduler tick — a throw there would
  // strand queued tasks until the next scheduleCallback. Boundary-captured
  // errors never reach the catch; they schedule the boundary instead.
  function performReactiveEffects(root: R): void {
    try {
      flushReactiveEffects(root);
    } catch (error) {
      const info = root.uncaughtErrorInfo ?? errorInfoFor(root.current, error);
      clearRootAfterUncaughtError(root);
      reportUncaughtError(root, error, info);

      if (root.onUncaughtError === null) {
        setTimeout(() => {
          throw error;
        });
      }
    }
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
    walkFiberForest(node, (cursor) => {
      for (const effect of cursor.effects ?? []) visitor(effect);

      return (
        (cursor.flags & AdoptedFlag) === 0 &&
        !isHiddenBoundary(cursor) &&
        (cursor.subtreeFlags & EffectFlag) !== 0
      );
    });
  }

  // Deliberately traverses adopted subtrees: unmount aborts and commit-time
  // external store checks must reach hooks that did not re-render.
  function visitFiberHooks(
    node: F | null,
    visitor: (owner: F, hook: Hook) => void,
  ): void {
    walkFiberForest(node, (cursor) => {
      for (let hook = cursor.memoizedState; hook !== null; hook = hook.next) {
        visitor(cursor, hook);
      }
    });
  }

  function visitRenderedFiberHooks(
    node: F | null,
    visitor: (owner: F, hook: Hook) => void,
  ): void {
    walkFiberForest(node, (cursor) => {
      for (let hook = cursor.memoizedState; hook !== null; hook = hook.next) {
        visitor(cursor, hook);
      }

      return (cursor.flags & AdoptedFlag) === 0;
    });
  }

  function isExternalStoreHook(
    hook: Hook,
  ): hook is Hook<ExternalStoreState<unknown, F>> {
    return hook.kind === ExternalStoreHook;
  }

  function runEffect(effect: Effect): void {
    let runStrict = false;
    if (__DEV__) {
      // Marked before create so renders nested inside the effect carry it
      // forward and never re-enter the strict cycle.
      runStrict = !effect.strictRan;
      effect.strictRan = true;
    }
    abortEffect(effect);
    let controller = new AbortController();
    effect.controller = controller;
    // Effects run with the ambient data store set, like render and event
    // dispatch, so preloadData/invalidateData work synchronously inside them.
    const dataStore = rootOf(effect.owner as F).dataStore;
    try {
      dataStore.run(() => effect.create(controller.signal));
      if (__DEV__ && runStrict) {
        // Strict re-run: abort and re-invoke first-time effects so work that
        // ignores its AbortSignal surfaces in development.
        abortEffect(effect);
        controller = new AbortController();
        effect.controller = controller;
        dataStore.run(() => effect.create(controller.signal));
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

  // retirePending: hide keeps the tree alive, so retired transition/action
  // runs must also release their pending slots (the decrement schedules at
  // the run's lane and downgrades to the offscreen lane like any hidden
  // update); deletions and root unmount skip the scheduling — the fiber is
  // going away, so only the abort matters.
  // Walks the node AND its siblings (a hiding boundary tears down all of
  // its content children). Deletion teardown must NOT use this: deletion
  // entries' sibling pointers reference kept fibers — it walks each deleted
  // subtree itself and calls abortFiberHooks per fiber.
  function abortFiberEffects(node: F, retirePending = false): void {
    walkFiberForest(node, (cursor) => {
      abortFiberHooks(cursor, retirePending);
    });
  }

  function abortFiberHooks(owner: F, retirePending: boolean): void {
    for (let hook = owner.memoizedState; hook !== null; hook = hook.next) {
      if (isEffectHook(hook.kind)) abortEffect(hook.memoizedState as Effect);
      if (isExternalStoreHook(hook))
        unsubscribeExternalStore(hook.memoizedState);
      if (isStableEventHook(hook)) {
        const instance = hook.memoizedState.instance;
        instance.controller?.abort();
        instance.controller = null;
        // Calls after unmount (or while hidden) still run the last committed
        // handler, but with a signal that is already aborted.
        instance.live = false;
      }
      if (hook.kind === TransitionHook) {
        const state = hook.memoizedState as TransitionState;
        if (retireRun(state.instance) && retirePending) {
          scheduleHookUpdate(
            owner,
            hook.queue as HookQueue<TransitionState>,
            (previous) => ({
              ...previous,
              pendingCount: Math.max(0, previous.pendingCount - 1),
            }),
            DefaultLane,
          );
        }
      }
      if (hook.kind === ActionStateHook) {
        const state = hook.memoizedState as ActionState<unknown, unknown[]>;
        if (retireRun(state.instance) && retirePending) {
          scheduleHookUpdate(
            owner,
            hook.queue as HookQueue<ActionState<unknown, unknown[]>>,
            (previous) => ({
              ...previous,
              pending: Math.max(0, previous.pending - 1),
            }),
            DefaultLane,
          );
        }
      }
    }
  }

  function abortEffect(effect: Effect): void {
    effect.controller?.abort();
    effect.controller = null;
  }

  function unsubscribeExternalStore(
    state: ExternalStoreState<unknown, F>,
  ): void {
    if (state.instance.owner !== null) {
      rootOf(state.instance.owner).externalStores.delete(state.instance);
    }
    state.instance.unsubscribe?.();
    state.instance.unsubscribe = null;
    state.instance.committedSubscribe = null;
    state.instance.owner = null;
  }

  function restoreConsumedPendingQueues(root: R, from = 0): void {
    for (const consumed of root.consumedPendingQueues.splice(from)) {
      restoreConsumedPendingQueue(consumed);
    }
  }

  function restoreConsumedPendingQueuesForRetry(root: R, from: number): void {
    for (const consumed of root.consumedPendingQueues.splice(from)) {
      clearQueueLanes(consumed.pending);
      restoreConsumedPendingQueue(consumed);
    }
  }

  function restoreConsumedPendingQueue({
    queue,
    pending,
  }: ConsumedPendingQueue): void {
    queue.pending =
      queue.pending === null ? pending : mergeQueues(pending, queue.pending);
  }
}

function observeDiscardedPromiseChildren(node: FigNode): void {
  if (Array.isArray(node)) {
    for (const child of node) observeDiscardedPromiseChildren(child);
    return;
  }

  if (isValidElement(node)) {
    observeDiscardedPromiseChildren(node.props.children);
    return;
  }

  if (isPortal(node)) {
    observeDiscardedPromiseChildren(node.children);
    return;
  }

  if (isThenable(node)) trackThenable(node);
}

function activityHidden(props: Props): boolean {
  return props.mode === "hidden";
}

// Dev-only (inline-gated at call sites): maps a numeric kind back to its
// public FigDevtoolsHookKind name for readable errors.
function hookKindName(kind: HookKind): string | number {
  return __DEV__ ? hookKindNames[kind] : kind;
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

// Aborts and retires the instance's live run (if any): its generation is
// invalidated so any later settlement is inert. Returns whether a run was
// retired, so callers release its pending slot exactly once.
function retireRun(instance: RunInstance): boolean {
  const controller = instance.controller;
  if (controller === null) return false;
  instance.controller = null;
  instance.generation += 1;
  controller.abort();
  return true;
}

function createActionState<S, Args extends unknown[]>(
  action: ActionStateAction<S, Args>,
  value: S,
): ActionState<S, Args> {
  return {
    action,
    error: NoActionStateError,
    instance: { action, controller: null, generation: 0, runner: null, value },
    pending: 0,
    value,
  };
}

function resolveInitialState<S>(initialState: S | (() => S)): S {
  return typeof initialState === "function"
    ? (initialState as () => S)()
    : initialState;
}

function sameType<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
  child: NormalizedChild,
): boolean {
  if (typeof child === "string") {
    return fiber.tag === TextTag;
  }

  if (isPortal(child)) {
    return fiber.tag === PortalTag && fiber.props.target === child.target;
  }

  if (isValidElement(child)) {
    if (__DEV__) {
      return matchesComponentFamily(fiber.type, child.type);
    }

    return fiber.type === child.type;
  }

  return isThenable(child) && fiber.tag === ThenableTag;
}

function propsFor(child: NormalizedChild): Props {
  if (typeof child === "string") {
    return { nodeValue: child };
  }

  if (isPortal(child)) return portalProps(child);
  if (isValidElement(child)) return child.props;
  if (isThenable(child)) return { thenable: child };

  throw invalidChildError(child);
}

function portalProps(child: FigPortal): Props {
  return { children: child.children, target: child.target };
}

function validateChildKey(
  child: NormalizedChild,
  seenKeys: Set<string> | null,
): void {
  if (seenKeys === null) return;

  const key = childExplicitKey(child);
  if (key === null) return;

  if (seenKeys.has(key)) throw duplicateKeyError(key);
  seenKeys.add(key);
}

function sameChildKey<Container, Instance, TextInstance>(
  fiber: Fiber<Container, Instance, TextInstance>,
  child: NormalizedChild,
  index: number,
): boolean {
  const key = childExplicitKey(child);
  return key === null
    ? fiber.key === null && fiber.index === index
    : fiber.key !== null && String(fiber.key) === key;
}

function childExplicitKey(child: NormalizedChild): string | null {
  return (isValidElement(child) || isPortal(child)) && child.key !== null
    ? String(child.key)
    : null;
}

function duplicateKeyError(key: string | number): Error {
  return new Error(`Duplicate key "${String(key)}" found among siblings.`);
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
