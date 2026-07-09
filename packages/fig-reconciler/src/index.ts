import {
  type ActionStateAction,
  type ActionStateRunner,
  type DataRefreshResult,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DependencyList,
  type EffectCallback,
  type ElementType,
  type ErrorInfo,
  type ExternalStoreSubscribe,
  type FigContext,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
  type FigElement,
  type FigNode,
  type FigPortal,
  Fragment,
  type Props,
  type StableEventArgs,
  type StartTransition,
  type StateSetter,
  type ViewTransitionClass,
  type ViewTransitionProps,
} from "@bgub/fig";
import {
  collectChildren,
  dataResourceKeysForError,
  type FigDataStore,
  type FigDataStoreFactory,
  type FigDataStoreHost,
  invalidChildError,
  isActivity,
  isAssets,
  isContext,
  isErrorBoundary,
  isPortal,
  isSuspense,
  isThenable,
  isValidElement,
  isViewTransition,
  type NormalizedChild,
  type RenderDispatcher,
  readThenable,
  setCurrentDataStore,
  setCurrentDispatcher,
  setTransitionHandler,
  type Thenable,
} from "@bgub/fig/internal";
import {
  devtoolsTypeName,
  type FigDevtoolsCommitInspection,
  type FigDevtoolsEffectPhase,
  type FigDevtoolsFiberKind,
  type FigDevtoolsFiberSnapshot,
  type FigDevtoolsHookKind,
  type FigDevtoolsHookSnapshot,
  type FigDevtoolsHostSnapshot,
  type FigDevtoolsRootSnapshot,
  type FigDevtoolsWorkLabel,
  getFigDevtoolsGlobalHook,
} from "./devtools.ts";
import {
  AllTransitionLanes,
  claimNextRetryLane,
  claimNextTransitionLane,
  createLaneMap,
  DefaultHydrationLane,
  DefaultLane,
  DeferredLane,
  GestureLane,
  getHighestPriorityLane,
  getLaneSchedulerPriority,
  getNextLanes,
  IdleHydrationLane,
  IdleLane,
  InputContinuousHydrationLane,
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
  SelectiveHydrationLane,
  SyncHydrationLane,
  SyncLane,
  TransitionHydrationLane,
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
import {
  NormalPriority,
  now,
  requestPaint,
  type ScheduledTask,
  scheduleCallback,
  shouldYieldToHost,
} from "./scheduler.ts";
export { act } from "./scheduler.ts";

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

export type ViewTransitionCommitResult = false | "committed" | "deferred";

export interface ViewTransitionSurfaceMeasurement {
  // Width/height changes of statically positioned surfaces relayout their
  // parent (React's AffectedParentLayout); absolutely positioned ones don't.
  absolutelyPositioned: boolean;
  height: number;
  inViewport: boolean;
  width: number;
  x: number;
  y: number;
}

// Computed inside the host's update callback, after mutations and new-side
// measurement: which already-captured groups turned out not to move (hide
// them at ready) and whether the whole-page snapshot can be dropped.
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
  // True when a view transition is currently running on the container's
  // document; `onFinished` fires once it settles (and never fires when this
  // returns false). Lets the reconciler park eligible commits behind a
  // running animation instead of committing under it.
  suspend?(this: void, container: Container, onFinished: () => void): boolean;
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
  // Hoisted instances (asset resources) live out-of-band, not at their
  // fiber's DOM position: the server emits nothing inline for them, so they
  // must not consume a node from the hydration cursor and their subtrees
  // render fresh; commit acquires them via commitHoistedInstance when the
  // fiber first commits and releases them via removeHoistedInstance when it
  // is deleted, instead of insertBefore/removeChild.
  isHoistedInstance?(type: string, props: Props): boolean;
  // May return a different instance when the fiber's identity already
  // resolves to a live shared instance (e.g. one inserted while this render
  // was suspended); the fiber adopts the returned instance.
  commitHoistedInstance?(instance: Instance): Instance | void;
  removeHoistedInstance?(instance: Instance): void;
  // Hoisted instances are shared by identity (key), so an update that
  // changes the identity must not mutate the shared instance in place; the
  // host releases the old identity and returns the instance to use, which
  // may differ from the current one.
  updateHoistedInstance?(
    instance: Instance,
    previousProps: Props,
    nextProps: Props,
  ): Instance;
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
  viewTransition?: ViewTransitionHostConfig<Container, Instance>;
  commitTextUpdate(text: TextInstance, value: string): void;
}

export type HostRenderConfig<Container, Instance, TextInstance> = Pick<
  HostConfig<Container, Instance, TextInstance>,
  | "createInstance"
  | "createTextInstance"
  | "appendInitialChild"
  | "finalizeInitialInstance"
  | "setTextContent"
  | "insertBefore"
  | "removeChild"
  | "commitUpdate"
  | "commitTextUpdate"
  | "shouldCommitUpdate"
  | "clearContainer"
>;

export type HostValidationConfig<Container, Instance, TextInstance> = Pick<
  HostConfig<Container, Instance, TextInstance>,
  "validateInstanceNesting" | "validateTextNesting" | "containerType"
>;

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
      | "isHoistedInstance"
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

export interface FigRenderer<Container> {
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
  scheduleRefresh(this: void, update: RefreshUpdate): void;
}

type RequiredHydrationHostConfig<Container, Instance, TextInstance> =
  HostHydrationConfig<Container, Instance, TextInstance>;

const RootTag = 0;
const HostTag = 1;
const TextTag = 2;
const FunctionTag = 3;
const FragmentTag = 4;
const ContextProviderTag = 5;
const SuspenseTag = 6;
const ErrorBoundaryTag = 7;
const PortalTag = 8;
const AssetsTag = 9;
const ActivityTag = 10;
const ViewTransitionTag = 11;
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
  | typeof AssetsTag
  | typeof ActivityTag
  | typeof ViewTransitionTag;

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
const DeletionFlag = 1 << 7;
const DataDependencyFlag = 1 << 8;
const EffectFlag = 1 << 9;
const ContextPropagationFlag = 1 << 10;
const StoreConsistencyFlag = 1 << 11;
const ViewTransitionStaticFlag = 1 << 12;
type Flag = number;

const MutationMask =
  PlacementFlag | UpdateFlag | HydrationFlag | TextContentFlag | VisibilityFlag;
// Static flags record unchanging facts about a subtree (a ViewTransition
// exists below here), not pending commit work. They must survive commits and
// bailouts: cleared bits would make boundaries inside adopted subtrees
// invisible to commit-time collection and deleted subtrees unsearchable
// without a full walk. Mirrors React's StaticMask.
const StaticFlagsMask = ViewTransitionStaticFlag;
// A commit may animate only when every rendered lane is transition-shaped:
// transitions, retries (client Suspense reveals), deferred follow-ups, idle.
// Hydration lanes are excluded on purpose — hydration changes no pixels, so
// animating an "enter" for freshly hydrated boundaries is a visible glitch —
// and only-eligible (not some-lane) semantics keep urgent updates that were
// batched into the commit (expiration, entanglement) from being captured
// mid-animation. Mirrors React's includesOnlyViewTransitionEligibleLanes.
const ViewTransitionEligibleLanes =
  AllTransitionLanes | RetryLanes | DeferredLane | IdleLane;

const ReactiveEffect = 0;
const BeforePaintEffect = 1;
const BeforeLayoutEffect = 2;
type EffectPhase =
  | typeof ReactiveEffect
  | typeof BeforePaintEffect
  | typeof BeforeLayoutEffect;

// Hook kinds are numeric internally; effect hooks reuse their EffectPhase
// constant as the kind, so isEffectHook is a range check and updateEffectHook
// needs no separate kind argument. Devtools snapshots and dev-only errors map
// back to the public FigDevtoolsHookKind strings through hookKindNames.
const StateHook = 3;
const ActionStateHook = 4;
const IdHook = 5;
const DeferredValueHook = 6;
const ExternalStoreHook = 7;
const MemoHook = 8;
const TransitionHook = 9;
const StableEventHook = 10;
type HookKind = number;

const hookKindNames: readonly FigDevtoolsHookKind[] = [
  "reactive",
  "before-paint",
  "before-layout",
  "state",
  "action-state",
  "id",
  "deferred-value",
  "external-store",
  "memo",
  "transition",
  "stable-event",
];

// The queue payload: what a StateSetter accepts.
type StateUpdate<S> = S | ((previous: S) => S);

interface HookUpdate<S> {
  action: StateUpdate<S>;
  lane: Lane;
  next: HookUpdate<S>;
}

interface HookQueue<S> {
  pending: HookUpdate<S> | null;
  dispatch: StateSetter<S> | null;
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

interface ContextDependency {
  context: FigContext<unknown>;
  memoizedValue: unknown;
}

interface SuspensePings<Container, Instance, TextInstance> {
  boundaries: Set<Fiber<Container, Instance, TextInstance>>;
  lanes: WeakMap<Fiber<Container, Instance, TextInstance>, Lanes>;
}

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
  suspenseState: SuspenseState<Container, Instance, TextInstance> | null;
  suspenseQueueStart?: number;
  hiddenState: HiddenState<Container, Instance, TextInstance> | null;
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

interface ViewTransitionState {
  autoName: string | null;
}

type ViewTransitionPhase = "enter" | "exit" | "share" | "update";

interface ViewTransitionSurface<Instance> {
  boundary: object;
  className: string | null;
  instance: Instance;
  // Old-side geometry, captured while applying names before the old
  // snapshot; the post-mutation pass compares against fresh measurements.
  measurement: ViewTransitionSurfaceMeasurement | null;
  // Content-driven updates and share pairs animate regardless of geometry;
  // layout-driven updates and moves let measurement decide.
  mustAnimate: boolean;
  name: string;
  phase: ViewTransitionPhase;
  props: Props;
  // Gated out (viewport, unchanged geometry): no name applied on this side.
  skipped: boolean;
}

interface ViewTransitionPlan<Instance> {
  newSurfaces: ViewTransitionSurface<Instance>[];
  oldSurfaces: ViewTransitionSurface<Instance>[];
  // True when the commit also mutates layout outside annotated boundaries
  // (insertions, deletions, moves, or plain mutations not contained in a
  // collected boundary). When false the host may cancel the browser's
  // whole-page snapshot so untouched regions stay interactive.
  rootAffected: boolean;
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
  pendingViewTransitionCommit: boolean;
  // finishedWork is rendered but its commit waits for a running view
  // transition to finish. Unlike pendingViewTransitionCommit (the sub-frame
  // capture window, which freezes the root), a parked root keeps rendering:
  // newer work supersedes the parked tree so the latest state commits when
  // the animation ends.
  parkedViewTransitionCommit: boolean;
  dataStore: FigDataStore;
  contextValues: Map<FigContext<unknown>, unknown>;
  contextStack: ContextStackEntry<Container, Instance, TextInstance>[];
  externalStores: Set<
    ExternalStoreInstance<unknown, Fiber<Container, Instance, TextInstance>>
  >;
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
  commitEffectPhases: number;
  needsCommitDeletions: boolean;
  needsDataDependencyCommit: boolean;
  needsCaughtBoundaryErrorFlush: boolean;
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
): FigRenderer<Container> {
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
  type RequiredHoistedAssetHostConfig = HostConfig<
    Container,
    Instance,
    TextInstance
  > &
    HostHoistedAssetConfig<Container, Instance, TextInstance>;
  const roots = new WeakMap<object, R>();
  // Iterable view of live roots, only populated when a refresh handler is set,
  // so a hot-reload pass can walk every mounted tree (dev-only; empty in prod).
  const mountedRoots = new Set<R>();
  const pendingRoots = new Set<R>();
  const batchedRoots = new Set<R>();
  const abandonedHydrationBoundaries = new WeakSet<object>();
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
  let activityHostConfig: ReturnType<typeof requireActivityHostConfig> | null =
    null;
  let activityHydrationHostConfig: ActivityHydrationHostConfig | null = null;
  let hoistedAssetHostConfig: RequiredHoistedAssetHostConfig | null = null;
  const viewTransitionHost = host.viewTransition ?? null;
  let renderingFiber: F | null = null;
  let currentHook: Hook | null = null;
  let workInProgressHook: Hook | null = null;
  let localIdCounter = 0;
  let viewTransitionAutoNameCounter = 0;

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
      options?: FigRootOptions;
    },
  ): R {
    if (roots.has(container as object)) {
      throw duplicateRootError(request.kind);
    }

    if (request.kind === "hydration") requireHydrationHostConfig();

    const root = createFiberRoot(container, request.options ?? {});
    roots.set(container as object, root);
    if (hasRefreshHandler()) mountedRoots.add(root);

    if (request.kind === "hydration") {
      root.isHydrating = true;
      root.isHydrationRoot = true;
      root.needsRootHydrationCompletion = true;
    }

    return root;
  }

  function createFiberRoot(container: Container, options: FigRootOptions): R {
    const current = fiber(RootTag, null, null, { children: null }, null);
    const dataStore = createRootDataStore({
      getLane: requestUpdateLane,
      partition: options.dataPartition,
      schedule(owner: object, lane: unknown): void {
        scheduleFiber(owner as F, hiddenSubtreeLane(owner as F, lane as Lane));
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
      pendingViewTransitionCommit: false,
      parkedViewTransitionCommit: false,
      dataStore,
      contextValues: new Map(),
      contextStack: [],
      externalStores: new Set(),
      pendingReactiveEffects: [],
      reactiveCallback: null,
      suspendedThenables: new WeakMap(),
      suspendedBoundaries: new WeakMap(),
      consumedPendingQueues: [],
      onRecoverableError: options.onRecoverableError ?? noop,
      onUncaughtError: options.onUncaughtError ?? null,
      recoverableErrors: [],
      uncaughtErrorInfo: null,
      commitEffectPhases: 0,
      needsCommitDeletions: false,
      needsDataDependencyCommit: false,
      needsCaughtBoundaryErrorFlush: false,
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
      if (fiber?.suspenseState?.kind === "dehydrated") return fiber;
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
    pendingRoots.add(root);
    if (currentCommitEffectPhase === BeforePaintEffect && isSyncLane(lane)) {
      needsPostCommitSyncFlush = true;
    }
  }

  function markCommitEffectPhase(root: R, phase: EffectPhase): void {
    root.commitEffectPhases |= 1 << phase;
  }

  function scheduleOrBatchRoot(root: R): void {
    if (batchDepth > 0) batchedRoots.add(root);
    else scheduleRoot(root);
  }

  function scheduleRoot(root: R): void {
    if (root.pendingViewTransitionCommit) return;

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
    if (root.pendingViewTransitionCommit) return;

    if (root.pendingLanes === NoLanes && root.wip === null) {
      pendingRoots.delete(root);
      return;
    }

    flushPendingReactiveEffects(root);

    if (root.parkedViewTransitionCommit) {
      root.parkedViewTransitionCommit = false;
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
        if (node.tag === ContextProviderTag) pushContextProvider(node);
        cloneChildFibers(node);
        return;
      }
    }

    if (node.tag === ContextProviderTag) pushContextProvider(node);

    const hasOwnWork = includesSomeLane(node.lanes, root.renderLanes);
    node.lanes &= ~root.renderLanes;

    if (node.tag === FunctionTag) {
      renderFunction(node);
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
      if (tryHydrateText(node)) return;
      node.stateNode ??= host.createTextInstance(String(node.props.nodeValue));
      return;
    }

    if (node.tag === HostTag) {
      const type = String(node.type);
      const children = hostChildren(node.props);

      if (__DEV__) {
        let ancestors: string[] | null = null;

        if (node.alternate === null && host.validateInstanceNesting) {
          ancestors = hostAncestorTypes(node);
          host.validateInstanceNesting(type, node.props, ancestors);
        }

        // Text that becomes Text fibers is validated by the TextTag branch.
        if (host.validateTextNesting && shouldUseHostTextContent(node)) {
          const textContent = hostTextContent(children);
          if (textContent !== null) {
            ancestors ??= hostAncestorTypes(node);
            ancestors.unshift(type);
            host.validateTextNesting(textContent, ancestors);
          }
        }
      }

      if (tryHydrateInstance(node)) {
        reconcileCurrentChildren(node, children);
        return;
      }

      node.stateNode ??= host.createInstance(
        type,
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

    reconcileCurrentChildren(node, node.props.children);
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
    }
    node.stateNode ??= { autoName: null };
    reconcileCurrentChildren(node, node.props.children);
  }

  function beginActivity(root: R, node: F): void {
    const hidden = activityHidden(node.props);
    if (hidden) hasHiddenBoundaries = true;

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

    node.activityState ??= { hidden: false, dehydrated: null };

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

  function tryHydrateInstance(node: F): boolean {
    const root = rootOf(node);
    if (!shouldHydrateFiber(root, node)) return false;

    const hydrationHost = requireHydrationHostConfig();
    const hydratable = root.nextHydratableInstance;
    const type = String(node.type);

    // Falling through creates the instance out-of-band, leaving the cursor
    // for the fiber's siblings; the placement flag routes the fiber through
    // commitHoistedInstance so commit still acquires it.
    if (isHoistedFiber(node)) {
      node.flags |= PlacementFlag;
      return false;
    }

    if (
      hydratable === null ||
      !hydrationHost.canHydrateInstance(hydratable, type, node.props)
    ) {
      throwHydrationMismatch(root, node, `<${type}>`);
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
    node.flags |= UpdateFlag;
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

    if (root.nextHydratableInstance !== null) {
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

  function requireHydrationHostConfig(): RequiredHydrationHostConfig<
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

    return host as RequiredHydrationHostConfig<
      Container,
      Instance,
      TextInstance
    >;
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

  function shouldUseHostTextContent(node: F): boolean {
    return (
      host.setTextContent !== undefined &&
      // A host created out-of-band during hydration (hoisted instance)
      // renders fresh: its text must replace any server content wholesale
      // rather than match against it.
      (!rootOf(node).isHydrating || hydrationBypassedHost(node)) &&
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

  function isHoistedFiber(node: F): boolean {
    if (node.tag !== HostTag) return false;
    if (host.isHoistedInstance?.(String(node.type), node.props) !== true) {
      return false;
    }
    requireHoistedAssetHostConfig();
    return true;
  }

  function requireHoistedAssetHostConfig(): RequiredHoistedAssetHostConfig {
    if (hoistedAssetHostConfig !== null) return hoistedAssetHostConfig;

    if (
      host.isHoistedInstance === undefined ||
      host.commitHoistedInstance === undefined ||
      host.removeHoistedInstance === undefined ||
      host.updateHoistedInstance === undefined
    ) {
      throw new Error("Hoisted assets are not supported by this renderer.");
    }

    hoistedAssetHostConfig = host as RequiredHoistedAssetHostConfig;
    return hoistedAssetHostConfig;
  }

  function renderFunction(node: F): void {
    // Hot reload: run the latest version of this component's family. In
    // production no handler is set, so this is a no-op.
    if (hasRefreshHandler()) {
      node.type = resolveLatestType(node.type) as F["type"];
    }
    prepareHookRender(node);

    const previousDispatcher = setCurrentDispatcher(dispatcher);
    const previousDataStore = setCurrentDataStore(rootOf(node).dataStore);
    try {
      if (__DEV__) {
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
    const root = rootOf(node);
    renderingFiber = node;
    currentHook = node.alternate?.memoizedState ?? null;
    workInProgressHook = null;
    localIdCounter = 0;
    node.memoizedState = null;
    node.contextDependencies = null;
    root.dataStore.resetDataDependencies(node);
    node.dataDependenciesDirty = true;
    node.flags |= DataDependencyFlag;
    root.needsDataDependencyCommit = true;
  }

  function beginSuspense(node: F, hasOwnWork: boolean): void {
    const root = rootOf(node);
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

    node.suspenseState = {
      boundary,
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
        beginSuspensePrimary(node, suspensePrimaryFiber(node.alternate));
        return;
      }

      if (boundary.status === "pending") {
        node.suspenseState = {
          boundary,
          kind: "dehydrated",
          wasPending: true,
        };
        return;
      }
    }

    if (boundary.status === "client-rendered") {
      queueClientRenderedSuspenseError(rootOf(node), node, boundary);
    }

    node.suspenseState = null;
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
    const state = boundary?.alternate?.suspenseState;
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

  // Any throw while hydrating a dehydrated Activity abandons the attempt. For
  // mismatches, clear the dehydrated template before root recovery so the
  // forced client render cannot recurse into the same failed hydration.
  function abandonActivityHydration(root: R, forceClientRender = false): void {
    if (forceClientRender) {
      const state = root.hydratingActivityBoundary?.activityState;
      if (state !== undefined && state !== null) state.dehydrated = null;
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
    const previousErrorState = node.alternate?.errorBoundaryState ?? null;

    node.errorBoundaryState = previousErrorState;

    reconcileCurrentChildren(
      node,
      previousErrorState === null
        ? node.props.children
        : errorBoundaryFallback(node, previousErrorState),
    );
  }

  // A bare function is never a valid FigNode, so a function fallback is
  // unambiguously the render-with-error shape.
  function errorBoundaryFallback(node: F, state: ErrorBoundaryState): FigNode {
    const fallback = node.props.fallback as
      | FigNode
      | ((error: unknown, info: ErrorInfo) => FigNode)
      | undefined;
    return typeof fallback === "function"
      ? fallback(state.error, state.info)
      : fallback;
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

        // Last-run-wins: a new run aborts and retires the previous one,
        // releasing its pending slot now (on DefaultLane — the retired run's
        // held transition lane may never render). A retired run's settlement
        // — value or rejection — never touches state, error, or pending.
        if (retireRun(instance)) updatePending(-1, DefaultLane);

        const lane = claimNextTransitionLane();
        const controller = new AbortController();
        const generation = (instance.generation += 1);
        instance.controller = controller;
        updatePending(1, SyncLane);

        const settleIfLive = (): boolean => {
          if (generation !== instance.generation) return false;
          instance.controller = null;
          return true;
        };

        let result: S | PromiseLike<S>;
        try {
          result = rootOf(fiber).dataStore.run(() =>
            runWithTransitionLane(lane, () =>
              instance.action(instance.value, ...args, controller.signal),
            ),
          );
        } catch (error) {
          if (settleIfLive()) finish(lane, error);
          return;
        }

        if (!isThenable(result)) {
          if (settleIfLive()) finish(lane, NoActionStateError, result);
          return;
        }

        result.then(
          (value) => {
            if (settleIfLive()) finish(lane, NoActionStateError, value);
          },
          (error: unknown) => {
            if (settleIfLive()) finish(lane, error);
          },
        );
      }) as unknown as StateSetter<ActionState<S, Args>>;
    }

    if (hook.memoizedState.error !== NoActionStateError) {
      throw hook.memoizedState.error;
    }

    return [
      hook.memoizedState.value,
      queue.dispatch as unknown as ActionStateRunner<Args>,
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

      const instance = hook.memoizedState.instance;
      hook.memoizedState.start = (
        callback: (signal: AbortSignal) => void | PromiseLike<void>,
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
        if (retireRun(instance)) updatePending(-1, DefaultLane);

        const lane = claimNextTransitionLane();
        const controller = new AbortController();
        const generation = (instance.generation += 1);
        instance.controller = controller;
        updatePending(1, SyncLane);

        // Retired settlements are fully inert: the pending slot was released
        // at abort time, state updates the callback already made stay
        // committed (aborting is a signal, not an unwind), and rejections
        // are swallowed — an aborted fetch rejecting is the happy path.
        const settleIfLive = (): boolean => {
          if (generation !== instance.generation) return false;
          instance.controller = null;
          updatePending(-1, lane);
          return true;
        };

        let result: unknown;
        try {
          result = rootOf(fiber).dataStore.run(() =>
            runWithTransitionLane(lane, () => callback(controller.signal)),
          );
        } catch (error) {
          if (settleIfLive()) throw error;
          return;
        }

        if (!isThenable(result)) {
          settleIfLive();
          return;
        }

        result.then(
          () => void settleIfLive(),
          (error: unknown) => {
            if (settleIfLive()) {
              queueMicrotask(() => {
                throw error;
              });
            }
          },
        );
      };
    }

    // Assigned above when null; queued updates spread the previous state, so
    // the starter is always carried forward.
    return [
      hook.memoizedState.pendingCount > 0,
      hook.memoizedState.start as StartTransition,
    ];
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

    fiber.flags |= StoreConsistencyFlag;
    appendHook(createHook(ExternalStoreHook, state));
    return value;
  }

  function updateStableEventHook<Args extends unknown[], Result>(
    handler: (...args: Args) => Result,
  ): (...args: StableEventArgs<Args>) => Result {
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
    return instance.stable as (...args: StableEventArgs<Args>) => Result;
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
    const update: HookUpdate<S> = { action, lane, next: null as never };
    update.next = update;
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
        isHiddenBoundaryTag(parent) &&
        parent.activityState?.hidden === true
      ) {
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
      fiber.flags |= EffectFlag;
      markCommitEffectPhase(rootOf(fiber), phase);
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

  function pushContextProvider(node: F): void {
    const root = rootOf(node);
    const context = node.type as unknown as FigContext<unknown>;
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
      subtreeFlags |= child.flags;
      subtreeFlags |= child.subtreeFlags;
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
    const seenKeys = __DEV__ ? new Set<string>() : null;

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
      if (!sameChildKey(old, child, index) || !sameType(old, child)) {
        break;
      }
      validateChildKey(child, seenKeys);

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
    parent.deletions ??= [];
    parent.deletions.push(child);
    parent.flags |= DeletionFlag;
    rootOf(parent).needsCommitDeletions = true;
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

  // Shared by the commit-parking gate and the plan builder. Parking uses
  // this WITHOUT checking for boundaries on purpose: even a commit with no
  // annotated surfaces must not land under a running animation — mutations
  // to captured regions stay invisible until the animation settles and then
  // pop in. React parks all eligible commits the same way.
  function isViewTransitionEligibleCommit(root: R): boolean {
    return (
      !root.clearContainerBeforeCommit &&
      root.renderLanes !== NoLanes &&
      (root.renderLanes & ~ViewTransitionEligibleLanes) === NoLanes &&
      viewTransitionHost !== null
    );
  }

  function prepareViewTransitionPlan(
    root: R,
    finishedWork: F,
  ): ViewTransitionPlan<Instance> | null {
    if (!isViewTransitionEligibleCommit(root)) return null;
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
    const exitsByName = new Map<string, F>();

    if (root.needsCommitDeletions) {
      collectDeletedViewTransitions(finishedWork, plan, exitsByName);
    }
    collectFinishedViewTransitions(
      finishedWork.child,
      false,
      false,
      false,
      plan,
      exitsByName,
    );

    if (plan.oldSurfaces.length === 0 && plan.newSurfaces.length === 0) {
      return null;
    }

    if (__DEV__) warnOnDuplicateViewTransitionNames(plan);
    return plan;
  }

  // Two live boundaries sharing one view-transition-name make the browser
  // silently skip the whole transition, which reads as "animations randomly
  // stopped working" — surface it. Old and new sides are checked separately:
  // the same name on both sides is exactly how pairs morph.
  function warnOnDuplicateViewTransitionNames(
    plan: ViewTransitionPlan<Instance>,
  ): void {
    for (const surfaces of [plan.oldSurfaces, plan.newSurfaces]) {
      const owners = new Map<string, object>();
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
    node: F,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, F>,
  ): void {
    walkFiberSubtree(node, (cursor) => {
      if (cursor.deletions !== null) {
        for (const deletion of cursor.deletions) {
          collectDeletedViewTransitionFiber(deletion, plan, exitsByName, true);
        }
      }

      return (cursor.subtreeFlags & DeletionFlag) !== 0;
    });
  }

  // A deletions entry is a single detached subtree; its sibling pointers
  // still reference kept fibers in the old child list, so only the entry
  // itself is walked, never its siblings.
  function collectDeletedViewTransitionFiber(
    cursor: F,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, F>,
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
      // The outermost deleted boundary owns the exit; deeper named
      // boundaries never exit on their own but stay eligible to pair with
      // an appearing counterpart (share).
      for (let child = cursor.child; child !== null; child = child.sibling) {
        collectDeletedViewTransitionFiber(child, plan, exitsByName, false);
      }
      return;
    }

    // Deleted fibers committed before, so their persisted static flag is
    // authoritative: no bit means no boundary anywhere below — skip the
    // subtree instead of walking every deleted fiber.
    if ((cursor.subtreeFlags & ViewTransitionStaticFlag) === 0) return;
    for (let child = cursor.child; child !== null; child = child.sibling) {
      collectDeletedViewTransitionFiber(child, plan, exitsByName, collectExit);
    }
  }

  function collectFinishedViewTransitions(
    node: F | null,
    placed: boolean,
    insideBoundary: boolean,
    // A fiber whose own props or child list changed re-lays-out its
    // descendants, so boundaries below it may move without any mutation of
    // their own (a container's gap/class change is the classic case). React
    // measures such "nested" boundaries and cancels the still ones; without
    // measurement Fig collects them as updates and lets identical-geometry
    // morphs be visual no-ops. Sibling-insertion shifts are still missed:
    // placement flags live on the inserted fiber, not its parent.
    ancestorLayoutChanged: boolean,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, F>,
  ): void {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      const cursorPlaced = placed || (cursor.flags & PlacementFlag) !== 0;
      const containsViewTransition =
        cursor.tag === ViewTransitionTag ||
        (cursor.subtreeFlags & ViewTransitionStaticFlag) !== 0;

      if (!containsViewTransition) {
        // Changes out here are not contained by any boundary: the root
        // snapshot must stay so the browser cross-fades them.
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
      // Stably hidden content is never captured by the browser, so its
      // boundaries must not create surfaces (or a plan). A boundary hiding
      // this commit still walks: its old side was visible and animates away.
      if (isStablyHiddenBoundary(cursor)) continue;

      if (cursor.tag === ViewTransitionTag) {
        if (cursorPlaced || cursor.alternate === null) {
          // Hydration mounts fresh fibers over already-visible server
          // pixels: nothing enters visually, so a hydrated boundary must not
          // animate (retry-lane commits that finish a dehydrated Suspense
          // boundary land here). React reaches the same outcome by keying
          // enter off Placement flags, which hydration never sets.
          if (
            !cursorPlaced &&
            ((cursor.flags | cursor.subtreeFlags) & HydrationFlag) !== 0
          ) {
            continue;
          }
          const pairedExit = exitsByName.get(viewTransitionName(cursor));
          if (pairedExit !== undefined) {
            // A pair vacates one slot and fills another: both relayout.
            if (!insideBoundary) plan.rootAffected = true;
            collectViewTransitionPair(plan, pairedExit, cursor);
            exitsByName.delete(viewTransitionName(cursor));
          } else if (cursor.alternate !== null) {
            // A moved boundary keeps its identity: naming both the committed
            // and finished instances lets the browser morph position instead
            // of treating the move as an enter-only cross-fade. Measurement
            // decides whether it actually moved, and reorder companions are
            // themselves flagged, so the root snapshot is not forced here.
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
            // An insertion changes the sibling count at its slot: the
            // surrounding layout shifts, so the root cross-fade must stay.
            if (!insideBoundary) plan.rootAffected = true;
            collectViewTransitionSurfaces(
              cursor,
              "enter",
              plan.newSurfaces,
              "finished",
            );
          }
          // Named boundaries deeper in a new or moved subtree never enter on
          // their own, but they can still pair with a deleted counterpart.
          collectAppearingPairViewTransitions(cursor.child, plan, exitsByName);
          continue;
        }

        // The innermost boundary owns an update: this boundary only animates
        // when something changed outside its nested boundaries (or an
        // ancestor's layout change moved it), and the walk always descends
        // so nested boundaries classify their own changes (an outer
        // update="none" must not disable them).
        const current = cursor.alternate;
        const contentChanged = viewTransitionChangedOutsideNested(cursor);
        if (current !== null && (contentChanged || ancestorLayoutChanged)) {
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
          contentChanged || ancestorLayoutChanged,
          plan,
          exitsByName,
        );
        continue;
      }

      if (cursor.tag !== PortalTag) {
        // The fiber's own mutations and deletions sit outside any boundary
        // deeper in its subtree.
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
          ancestorLayoutChanged ||
            (cursor.flags & (MutationMask | DeletionFlag)) !== 0,
          plan,
          exitsByName,
        );
      }
    }
  }

  function collectAppearingPairViewTransitions(
    node: F | null,
    plan: ViewTransitionPlan<Instance>,
    exitsByName: Map<string, F>,
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
    oldBoundary: F,
    newBoundary: F,
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

  function isStablyHiddenBoundary(node: F): boolean {
    if (!isHiddenBoundary(node)) return false;
    const current = node.alternate;
    return (
      current === null || activityHidden(current.memoizedProps ?? current.props)
    );
  }

  function viewTransitionChangedOutsideNested(boundary: F): boolean {
    if ((boundary.flags & (MutationMask | DeletionFlag)) !== 0) return true;
    return subtreeChangedOutsideNested(boundary.child);
  }

  function subtreeChangedOutsideNested(node: F | null): boolean {
    for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
      if (cursor.tag === PortalTag) continue;
      // A nested boundary owns everything below it, including its own flags.
      if (cursor.tag === ViewTransitionTag) continue;
      if ((cursor.flags & (MutationMask | DeletionFlag)) !== 0) return true;
      if ((cursor.subtreeFlags & (MutationMask | DeletionFlag)) === 0) continue;
      if (subtreeChangedOutsideNested(cursor.child)) return true;
    }

    return false;
  }

  function removeViewTransitionSurfaces(
    surfaces: ViewTransitionSurface<Instance>[],
    boundary: F,
  ): void {
    for (let index = surfaces.length - 1; index >= 0; index -= 1) {
      const surface = surfaces[index];
      if (surface.boundary === boundary) surfaces.splice(index, 1);
    }
  }

  function collectViewTransitionSurfaces(
    boundary: F,
    phase: ViewTransitionPhase,
    surfaces: ViewTransitionSurface<Instance>[],
    propsSource: "committed" | "finished",
    mustAnimate = true,
  ): void {
    const className = viewTransitionClass(boundary.props, phase);
    if (className === "none") return;

    const name = viewTransitionName(boundary);
    let index = 0;

    const collect = (node: F | null): void => {
      for (let cursor = node; cursor !== null; cursor = cursor.sibling) {
        if (cursor.tag === PortalTag) continue;
        if (cursor.tag === ViewTransitionTag) continue;
        if (cursor.tag === HostTag) {
          if (!isHoistedFiber(cursor)) {
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
    node: F,
    source: "committed" | "finished",
  ): Props {
    if (source === "committed") {
      return node.committedProps ?? node.memoizedProps ?? node.props;
    }
    return node.memoizedProps ?? node.props;
  }

  function viewTransitionName(node: F): string {
    const props = node.props as ViewTransitionProps;
    if (props.name !== undefined && props.name !== "auto") return props.name;

    const state = node.stateNode as ViewTransitionState;
    state.autoName ??= `fig-vt-${viewTransitionAutoNameCounter++}`;
    return state.autoName;
  }

  function explicitViewTransitionName(node: F): string | null {
    const name = (node.props as ViewTransitionProps).name;
    return name === undefined || name === "auto" ? null : name;
  }

  function viewTransitionClass(
    props: Props,
    phase: "enter" | "exit" | "share" | "update",
  ): ViewTransitionClass | null {
    const viewTransitionProps = props as ViewTransitionProps;
    const phaseClass = viewTransitionProps[phase];
    const className =
      phaseClass === undefined ? viewTransitionProps.default : phaseClass;

    if (className === undefined || className === "auto") return null;
    if (className === "none") return "none";
    return className;
  }

  // The prepare pass, before the browser captures the old state: measure and
  // name the old-side surfaces. Exits gate on the old viewport alone — the
  // element is leaving, so offscreen exits never participate (React reverts
  // these the same way before its old capture).
  function applyOldViewTransitionSurfaces(
    plan: ViewTransitionPlan<Instance>,
  ): void {
    if (viewTransitionHost === null) return;
    const measure = viewTransitionHost.measure;

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
      viewTransitionHost.apply(
        surface.instance,
        surface.name,
        surface.className,
      );
    }
  }

  // The resolve pass, inside the update callback after mutations landed and
  // before the browser captures the new state. Fresh measurements decide who
  // really animates, mirroring React's after-mutation pass:
  // - enters gate on the new viewport;
  // - layout-driven updates whose geometry did not change are canceled (the
  //   new name is withheld and the already-captured old group is hidden at
  //   ready), while content-driven updates and share pairs always animate;
  // - a resize of a statically positioned surface relayouts its parent, and
  //   a shrunken surface list relayouts its slot, so either keeps the root
  //   snapshot alive.
  function resolveViewTransitionPlan(
    plan: ViewTransitionPlan<Instance> | null,
  ): ViewTransitionMutationResult {
    const result: ViewTransitionMutationResult = {
      canceledNames: [],
      cancelRootSnapshot: false,
    };
    if (viewTransitionHost === null || plan === null) return result;
    const measure = viewTransitionHost.measure;

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
        applyViewTransitionSurface(viewTransitionHost, surface);
        continue;
      }

      if (surface.phase === "update") {
        const before = oldByName.get(surface.name)?.measurement ?? null;
        if (before !== null && measurement !== null) {
          const moved =
            before.x !== measurement.x ||
            before.y !== measurement.y ||
            before.width !== measurement.width ||
            before.height !== measurement.height;
          const offscreen = !before.inViewport && !measurement.inViewport;

          if (offscreen || (!surface.mustAnimate && !moved)) {
            // The prepare pass already named this instance (update surfaces
            // share it between sides); take the name back off so the new
            // capture skips it, and hide the old capture at ready.
            surface.skipped = true;
            viewTransitionHost.restore(surface.instance, surface.props);
            if (oldByName.has(surface.name)) {
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

      applyViewTransitionSurface(viewTransitionHost, surface);
    }

    // Update names with no new counterpart mean the surface list shrank:
    // that slot relayouts, and the dangling old capture exits.
    for (const [name, surface] of oldByName) {
      if (surface.phase === "update" && !newNames.has(name)) {
        rootAffected = true;
      }
    }

    result.cancelRootSnapshot = !rootAffected;
    return result;
  }

  function applyViewTransitionSurface(
    viewTransitionHost: ViewTransitionHostConfig<Container, Instance>,
    surface: ViewTransitionSurface<Instance>,
  ): void {
    viewTransitionHost.apply(surface.instance, surface.name, surface.className);
  }

  function restoreViewTransitionSurfaces(
    plan: ViewTransitionPlan<Instance>,
  ): void {
    if (viewTransitionHost === null) return;

    const propsByInstance = new Map<Instance, Props>();
    for (const surface of plan.oldSurfaces) {
      propsByInstance.set(surface.instance, surface.props);
    }
    for (const surface of plan.newSurfaces) {
      propsByInstance.set(surface.instance, surface.props);
    }

    for (const [instance, props] of propsByInstance) {
      viewTransitionHost.restore(instance, props);
    }
  }

  function commitRoot(root: R, finishedWork: F): boolean {
    // While a previous view transition is animating, park eligible commits
    // instead of committing under it: mutations to captured surfaces would
    // stay invisible until the animation ends (a visual pop at settle), and
    // the browser cannot hand an interrupted transition off to a new one —
    // skipTransition() hard-stops and restarts, which is the jank this
    // avoids. Rendering stays live while parked, and any newer render
    // supersedes the parked tree (its lanes are still pending, so the fresh
    // render absorbs them): the LATEST state commits the moment the
    // animation finishes. This is React's suspend-commits model
    // (facebook/react#32002) — waiting is cheap because only the commit
    // waits, never the rendering. The park sits before every commit phase
    // so a superseded parked commit never runs its effects.
    if (
      !root.pendingViewTransitionCommit &&
      isViewTransitionEligibleCommit(root) &&
      viewTransitionHost?.suspend?.(root.container, () =>
        scheduleRoot(root),
      ) === true
    ) {
      root.parkedViewTransitionCommit = true;
      // The scheduler callback that carried this attempt is spent; clear it
      // so the finished-callback's (or a newer update's) scheduleRoot isn't
      // deduped against it.
      root.callback = null;
      root.callbackPriority = NoLane;
      return true;
    }

    commitDepth += 1;
    try {
      commitLiveHookInstances(finishedWork.child);
      if (hasHiddenBoundaries) armRevealedHiddenBoundaries(finishedWork.child);
      commitEffects(root, finishedWork.child, BeforeLayoutEffect);
      const viewTransitionPlan = prepareViewTransitionPlan(root, finishedWork);
      const commitHostChanges = () => {
        if (root.clearContainerBeforeCommit) {
          requireHydrationHostConfig().clearContainer(root.container);
          root.clearContainerBeforeCommit = false;
        }
        if (root.needsCommitDeletions) {
          commitDeletions(finishedWork);
          root.needsCommitDeletions = false;
        }
        if (root.needsDataDependencyCommit) {
          commitDataDependencies(root, finishedWork.child);
          root.needsDataDependencyCommit = false;
        }
        commitMutationEffects(finishedWork.child);
        if (hasHiddenBoundaries)
          commitHiddenBoundaryVisibility(finishedWork.child);
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
        markRootFinished(
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
          commitExternalStores(root, finishedWork.child);
          scheduleDehydratedSuspenseRetries(root);
          commitEffects(root, finishedWork.child, BeforePaintEffect);
          if (root.needsCaughtBoundaryErrorFlush) {
            flushCaughtBoundaryErrors(root, finishedWork.child);
            root.needsCaughtBoundaryErrorFlush = false;
          }
        } finally {
          // Once the tree is current its flags must be cleared even when a
          // commit step throws, or a later render would adopt stale flags.
          collectReactiveEffects(root, finishedWork.child);
          finishedWork.flags &= StaticFlagsMask;
          finishedWork.subtreeFlags &= StaticFlagsMask;
          scheduleReactiveEffects(root);
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
      const commitWithoutViewTransition = () => {
        commitHostChanges();
        completeCommit();
      };
      const commitWithViewTransition = (): ViewTransitionMutationResult => {
        const isDeferredCommit = root.pendingViewTransitionCommit;
        if (isDeferredCommit) commitDepth += 1;
        try {
          commitHostChanges();
          const resolution = resolveViewTransitionPlan(viewTransitionPlan);
          completeCommit();
          return resolution;
        } catch (error) {
          // A deferred commit runs inside the browser's startViewTransition
          // update callback, outside any performRoot frame. Rethrowing there
          // would strand the error in the transition's promise and leave the
          // root half-committed, so route it through the same uncaught-error
          // path performRoot uses.
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
          return { canceledNames: [], cancelRootSnapshot: false };
        } finally {
          if (isDeferredCommit) {
            root.pendingViewTransitionCommit = false;
            commitDepth -= 1;
            finishRootWork(root);
            flushPostCommitSyncWork();
          }
        }
      };
      if (viewTransitionPlan !== null && viewTransitionHost !== null) {
        const viewTransitionResult = viewTransitionHost.commit(
          root.container,
          () => applyOldViewTransitionSurfaces(viewTransitionPlan),
          commitWithViewTransition,
          () => restoreViewTransitionSurfaces(viewTransitionPlan),
        );

        if (viewTransitionResult === "deferred") {
          root.pendingViewTransitionCommit = true;
          root.callback = null;
          root.callbackPriority = NoLane;
          return true;
        }

        if (viewTransitionResult === "committed") return false;
      }

      commitWithoutViewTransition();
      return false;
    } finally {
      commitDepth -= 1;
    }
  }

  function walkFiberForest(
    node: F | null,
    visitor: (node: F) => boolean | void,
  ): void {
    walkFiberTree(node, true, visitor);
  }

  function walkFiberSubtree(
    node: F,
    visitor: (node: F) => boolean | void,
  ): void {
    walkFiberTree(node, false, visitor);
  }

  function walkFiberTree(
    node: F | null,
    includeRootSiblings: boolean,
    visitor: (node: F) => boolean | void,
  ): void {
    const stack: F[] = [];
    let cursor = node;

    while (cursor !== null) {
      const shouldDescend = visitor(cursor) !== false && cursor.child !== null;

      if ((includeRootSiblings || cursor !== node) && cursor.sibling !== null) {
        stack.push(cursor.sibling);
      }

      if (shouldDescend) {
        cursor = cursor.child;
      } else {
        cursor = stack.pop() ?? null;
      }
    }
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
        const state = boundary.suspenseState;
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
      if (cursor.suspenseState?.kind === "dehydrated") {
        count += 1;
        byStartMarker.set(cursor.suspenseState.boundary.start, cursor);
        // A dehydrated boundary has no live children to descend into, but its
        // siblings may be retriable too (e.g. several boundaries inside one
        // revealed Activity), so keep walking the sibling chain.
        if (
          !abandonedHydrationBoundaries.has(cursor) &&
          dehydratedSuspenseRetryLane(cursor.suspenseState.boundary) !== NoLane
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

  function flushCaughtBoundaryErrors(root: R, node: F | null): void {
    walkFiberForest(node, (cursor) => {
      flushCaughtBoundaryError(root, cursor);
    });
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
      deleteFiberDataTree(root.current.child);
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
    root.commitEffectPhases = 0;
    root.needsCommitDeletions = false;
    root.needsDataDependencyCommit = false;
    root.needsCaughtBoundaryErrorFlush = false;
    markRootFinished(root, NoLanes);
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

      if (
        (cursor.flags & (UpdateFlag | TextContentFlag)) !== 0 &&
        isHost(cursor)
      ) {
        const hostFiber = cursor;
        commitHostMutation(hostFiber, () => commitUpdate(hostFiber));
        // Prerendered mutations inside hidden trees must stay hidden.
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

    for (let placed: F | null = firstPlaced; placed !== afterPlaced; ) {
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
      hoistedHost.updateHoistedInstance(instance, previousProps, node.props) ??
      instance;

    if (next !== instance) {
      adoptSwappedHoistedInstance(node, next);
      return;
    }

    if ((node.flags & TextContentFlag) !== 0) {
      commitHostTextContent(node, previousProps);
    }
  }

  // The swapped-in instance starts fresh; adopt it on both alternates and
  // re-apply the fiber's text so updates target the live node.
  function adoptSwappedHoistedInstance(node: F, next: Instance): void {
    node.stateNode = next;
    if (node.alternate !== null) node.alternate.stateNode = next;

    const text = hostTextContent(node.props.children);
    if (text !== null) host.setTextContent?.(next, text);
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
    const resolved = hoistedHost.commitHoistedInstance(instance) ?? instance;
    if (resolved === instance) return;

    // The identity resolved to a shared live instance (e.g. inserted while
    // this render was suspended); drop the stale duplicate.
    adoptSwappedHoistedInstance(node, resolved);
  }

  function commitDeletions(node: F): void {
    walkFiberSubtree(node, (cursor) => {
      if (cursor.deletions !== null) {
        const parent = isHostParent(cursor)
          ? hostParentFor(cursor)
          : hostParent(cursor);
        for (const child of cursor.deletions) {
          deleteFiberData(child);
          abortFiberEffects(child);
          remove(child, parent);
        }
        cursor.deletions = null;
      }

      return (
        (cursor.flags & AdoptedFlag) === 0 &&
        (cursor.subtreeFlags & DeletionFlag) !== 0
      );
    });
  }

  function commitDataDependencies(root: R, node: F | null): void {
    walkFiberForest(node, (cursor) => {
      if (cursor.dataDependenciesDirty) {
        root.dataStore.commitDataDependencies(cursor, cursor.alternate);
        cursor.dataDependenciesDirty = false;
        if (cursor.alternate !== null)
          cursor.alternate.dataDependenciesDirty = false;
      }

      return (
        (cursor.flags & AdoptedFlag) === 0 &&
        (cursor.subtreeFlags & DataDependencyFlag) !== 0
      );
    });
  }

  function deleteFiberData(node: F): void {
    const store = rootOf(node).dataStore;
    deleteFiberDataFromStore(node, store);
  }

  function deleteFiberDataTree(node: F): void {
    const store = rootOf(node).dataStore;
    walkFiberTree(node, true, (cursor) => {
      deleteFiberDataOwner(cursor, store);
    });
  }

  function deleteFiberDataFromStore(node: F, store: R["dataStore"]): void {
    walkFiberSubtree(node, (cursor) => {
      deleteFiberDataOwner(cursor, store);
    });
  }

  function deleteFiberDataOwner(node: F, store: R["dataStore"]): void {
    store.releaseDataOwner(node);
    if (node.alternate !== null) store.releaseDataOwner(node.alternate);
    // A hidden boundary removed from the tree stops counting toward
    // `hasHiddenBoundaries`; both generations share the one state object.
    if (node.activityState !== null) hiddenStates.delete(node.activityState);
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

    if (node.tag === HostTag && isHoistedFiber(node)) {
      if (node.committedProps !== null) {
        requireHoistedAssetHostConfig().removeHoistedInstance(
          node.stateNode as Instance,
        );
      }
      return;
    }

    if (isHost(node)) {
      removePortalDescendants(node.child);
      removeHoistedDescendants(node.child);
      host.removeChild(parent, hostNode(node));
      return;
    }

    for (let child = node.child; child !== null; child = child.sibling) {
      remove(child, parent);
    }
  }

  // Hoisted instances are not DOM descendants of the removed host, so the
  // top-node removal above never reaches them; release them explicitly.
  function removeHoistedDescendants(node: F | null): void {
    if (host.isHoistedInstance === undefined) return;

    for (let child = node; child !== null; child = child.sibling) {
      if (child.tag === PortalTag) continue;

      if (child.tag === HostTag && isHoistedFiber(child)) {
        if (child.committedProps !== null && child.stateNode !== null) {
          requireHoistedAssetHostConfig().removeHoistedInstance(
            child.stateNode as Instance,
          );
        }
        continue;
      }

      removeHoistedDescendants(child.child);
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
    if (node?.tag !== SuspenseTag) return null;
    return node.suspenseState?.kind === "dehydrated"
      ? node.suspenseState.boundary
      : null;
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

    const currentPrimary = suspensePrimaryFiber(boundary.alternate);
    if (currentPrimary !== null) {
      boundary.suspenseState = { kind: "fallback", primaryChild: null };
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
    boundary.suspenseState = {
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
    rootOf(boundary).needsCaughtBoundaryErrorFlush = true;
    boundary.errorBoundaryState = createErrorBoundaryState(error, source);
    reconcileCurrentChildren(
      boundary,
      errorBoundaryFallback(boundary, boundary.errorBoundaryState),
    );
    return boundary.child ?? completeUnit(boundary);
  }

  function captureCommittedErrorBoundary(
    boundary: F,
    error: unknown,
    source: F,
  ): void {
    rootOf(boundary).needsCaughtBoundaryErrorFlush = true;
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
      pings = { boundaries: new Set(), lanes: new WeakMap() };
      root.suspendedBoundaries.set(thenable, pings);
    }

    pings.boundaries.add(boundary);
    pings.lanes.set(
      boundary,
      mergeLanes(pings.lanes.get(boundary) ?? NoLanes, lanes),
    );

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
    pingCurrentSuspenseBoundaries(root, pings);
  }

  function pingCurrentSuspenseBoundaries(
    root: R,
    pings: SuspensePings<Container, Instance, TextInstance>,
  ): void {
    for (const boundary of pings.boundaries) {
      const current = currentFiberForPing(root, boundary);
      if (current === null) continue;

      const lanes = mergeLanes(
        pings.lanes.get(current) ?? NoLanes,
        current.alternate === null
          ? NoLanes
          : (pings.lanes.get(current.alternate) ?? NoLanes),
      );
      if (lanes !== NoLanes) {
        scheduleFiber(current, suspenseRetryLane(lanes));
      }
    }
  }

  function currentFiberForPing(root: R, boundary: F): F | null {
    if (isInCurrentTree(root, boundary)) return boundary;
    const alternate = boundary.alternate;
    return alternate !== null && isInCurrentTree(root, alternate)
      ? alternate
      : null;
  }

  function isInCurrentTree(root: R, node: F): boolean {
    let cursor: F | null = node;
    while (cursor !== null && cursor.return !== null) {
      cursor = cursor.return;
    }
    return cursor === root.current;
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
        ? [node.type as unknown as FigContext<unknown>]
        : null;
    let changed: FigContext<unknown>[] | null = null;

    for (let parent = node.return; parent !== null; parent = parent.return) {
      if ((parent.flags & ContextPropagationFlag) !== 0) break;
      if (parent.tag !== ContextProviderTag) continue;

      const context = parent.type as unknown as FigContext<unknown>;
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
    if (
      node.tag === ContextProviderTag &&
      node.type === (context as unknown as ElementType | null)
    ) {
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
    next.memoizedState = current.memoizedState;
    next.stateNode = current.stateNode;
    next.return = current.return;
    next.child = null;
    next.sibling = null;
    next.index = current.index;
    next.flags = NoFlags;
    next.subtreeFlags = NoFlags;
    next.deletions = null;
    next.lanes = current.lanes;
    next.childLanes = current.childLanes;
    next.effects = null;
    next.contextDependencies = current.contextDependencies;
    next.contextSubtreeDependencies = current.contextSubtreeDependencies;
    next.dataDependenciesDirty = false;
    next.suspenseState = current.suspenseState;
    next.hiddenState = null;
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
      subtreeFlags: NoFlags,
      deletions: null,
      lanes: NoLanes,
      childLanes: NoLanes,
      effects: null,
      contextDependencies: null,
      contextSubtreeDependencies: null,
      dataDependenciesDirty: false,
      suspenseState: null,
      hiddenState: null,
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

  function isHiddenBoundary(node: F): boolean {
    return isHiddenBoundaryTag(node) && activityHidden(node.props);
  }

  function isHiddenBoundaryTag(node: F): boolean {
    return node.tag === ActivityTag;
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

      const boundary = isHiddenBoundaryTag(cursor);
      const boundaryHidden = boundary && activityHidden(cursor.props);

      if (boundary && (cursor.flags & VisibilityFlag) !== 0) {
        const effectiveHidden = hidden || boundaryHidden;
        const state = cursor.activityState;
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
        isHiddenBoundaryTag(cursor) &&
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
      owner.flags |= EffectFlag;
      markSubtreeFlag(owner, EffectFlag);
      markCommitEffectPhase(rootOf(owner), effect.phase);
    });
  }

  function commitLiveHookInstances(node: F | null): void {
    visitRenderedFiberHooks(node, (owner, hook) => {
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

  function commitExternalStores(root: R, node: F | null): void {
    walkFiberForest(node, (cursor) => {
      if ((cursor.flags & AdoptedFlag) !== 0) return false;

      if ((cursor.flags & StoreConsistencyFlag) !== 0) {
        for (let hook = cursor.memoizedState; hook !== null; hook = hook.next) {
          if (isExternalStoreHook(hook))
            commitExternalStore(root, cursor, hook.memoizedState);
        }
      }

      // Subscriptions under hidden boundaries are deferred until reveal.
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

    const runEffects = () => {
      visitEffects(node, (effect) => {
        if (effect.phase === phase) runCommitEffect(effect, phase);
      });
    };

    if (phase === BeforePaintEffect) {
      runWithPriority(SyncLane, runEffects);
    } else {
      runEffects();
    }
    root.commitEffectPhases &= ~mask;
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
      cursor.flags &= StaticFlagsMask;
      cursor.subtreeFlags &= StaticFlagsMask;
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
      cursor.flags &= StaticFlagsMask;
      cursor.subtreeFlags &= StaticFlagsMask;
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
  function abortFiberEffects(node: F, retirePending = false): void {
    visitFiberHooks(node, (owner, hook) => {
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
    });
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
      markHookQueueNoLane(consumed.pending);
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

  function markHookQueueNoLane(queue: HookUpdate<unknown>): void {
    let update = queue.next;
    do {
      update.lane = NoLane;
      update = update.next;
    } while (update !== queue.next);
  }
}

function activityHidden(props: Props): boolean {
  return props.mode === "hidden";
}

function isEffectHook(kind: HookKind): boolean {
  return kind <= BeforeLayoutEffect;
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
    instance: { action, controller: null, generation: 0, value },
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
  if (isAssets(element.type)) return AssetsTag;
  if (isContext(element.type)) return ContextProviderTag;
  if (isSuspense(element.type)) return SuspenseTag;
  if (isActivity(element.type)) return ActivityTag;
  if (isErrorBoundary(element.type)) return ErrorBoundaryTag;
  if (isViewTransition(element.type)) return ViewTransitionTag;
  return FunctionTag;
}

// Renderer bundles do not import @bgub/fig. Instead, resources created by
// that package carry the store factory on an internal symbol. Roots buffer
// initialData until the first real data resource operation lazily installs the
// store, covering code-split apps whose only dataResource import is a lazy chunk.
const DataStoreFactorySymbol = Symbol.for("fig.data-store-factory");

function createRootDataStore(host: FigDataStoreHost): FigDataStore {
  let inner: FigDataStore | null = null;
  let buffered: FigDataHydrationEntry[] | null = null;
  let disposed = false;

  function installStore<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
  ): FigDataStore {
    if (inner !== null) return inner;
    if (disposed) {
      throw new Error("Data resource APIs require a live Fig root.");
    }

    const factory = (
      resource as DataResource & Record<symbol, FigDataStoreFactory>
    )[DataStoreFactorySymbol];
    if (factory === undefined) {
      throw new Error("Data resource APIs require @bgub/fig.");
    }

    inner = factory(host);
    if (buffered !== null) inner.hydrate(buffered);
    buffered = null;
    return inner;
  }

  const store: FigDataStore = {
    hydrate(entries: readonly FigDataHydrationEntry[]): void {
      if (inner !== null) {
        inner.hydrate(entries);
        return;
      }
      (buffered ??= []).push(...entries);
    },
    run<T>(callback: () => T): T {
      if (inner !== null) return inner.run(callback);

      const previousStore = setCurrentDataStore(store);
      try {
        return callback();
      } finally {
        setCurrentDataStore(previousStore);
      }
    },
    readData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      args: TArgs,
      owner: object,
    ): TValue {
      return installStore(resource).readData(resource, args, owner);
    },
    preloadData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): void {
      installStore(resource).preloadData(resource, ...args);
    },
    invalidateData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): void {
      installStore(resource).invalidateData(resource, ...args);
    },
    invalidateDataError(error: unknown): boolean {
      return inner?.invalidateDataError(error) ?? false;
    },
    invalidateDataKey(key: DataResourceKey): void {
      inner?.invalidateDataKey(key);
    },
    invalidateDataPrefix(prefix: DataResourceKey): void {
      inner?.invalidateDataPrefix(prefix);
    },
    refreshData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): Promise<DataRefreshResult<TValue>> {
      return installStore(resource).refreshData(resource, ...args);
    },
    commitDataDependencies(owner: object, previousOwner: object | null): void {
      inner?.commitDataDependencies(owner, previousOwner);
    },
    deleteDataOwner(owner: object): void {
      inner?.deleteDataOwner(owner);
    },
    releaseDataOwner(owner: object): void {
      inner?.releaseDataOwner(owner);
    },
    resetDataDependencies(owner: object): void {
      inner?.resetDataDependencies(owner);
    },
    dispose() {
      disposed = true;
      inner?.dispose();
      inner = null;
      buffered = null;
    },
    inspectDataEntries() {
      return inner?.inspectDataEntries() ?? [];
    },
    snapshot() {
      return inner?.snapshot() ?? buffered?.slice() ?? [];
    },
  };

  return store;
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

  return (
    isValidElement(child) && matchesComponentFamily(fiber.type, child.type)
  );
}

function propsFor(child: NormalizedChild): Props {
  if (typeof child === "string") {
    return { nodeValue: child };
  }

  if (isPortal(child)) return portalProps(child);
  if (isValidElement(child)) return child.props;

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
    pendingWork: devtoolsWorkLabels(root.pendingLanes),
    suspendedWork: devtoolsWorkLabels(root.suspendedLanes),
    pingedWork: devtoolsWorkLabels(root.pingedLanes),
    expiredWork: devtoolsWorkLabels(root.expiredLanes),
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
    appendDevtoolsChildSnapshots(child, id, inspection, children);
  }

  return {
    id,
    parentId,
    name,
    kind,
    key: node.key,
    index: node.index,
    props: devtoolsProps(node),
    pendingWork: devtoolsWorkLabels(node.lanes),
    childWork: devtoolsWorkLabels(node.childLanes),
    hooks: devtoolsHooks(node.memoizedState),
    contextDependencies: devtoolsContextDependencies(node),
    host: devtoolsHost(node),
    capturedError: node.errorBoundaryState?.error,
    componentStack: node.errorBoundaryState?.info.componentStack,
    children,
  };
}

function devtoolsWorkLabels(lanes: Lanes): FigDevtoolsWorkLabel[] {
  const labels: FigDevtoolsWorkLabel[] = [];
  if (includesSomeLane(lanes, SyncHydrationLane | SyncLane))
    labels.push("sync");
  if (
    includesSomeLane(lanes, InputContinuousHydrationLane | InputContinuousLane)
  ) {
    labels.push("input");
  }
  if (includesSomeLane(lanes, DefaultHydrationLane | DefaultLane)) {
    labels.push("default");
  }
  if (includesSomeLane(lanes, GestureLane)) labels.push("gesture");
  if (includesSomeLane(lanes, AllTransitionLanes | TransitionHydrationLane)) {
    labels.push("transition");
  }
  if (includesSomeLane(lanes, RetryLanes)) labels.push("retry");
  if (includesSomeLane(lanes, IdleHydrationLane | IdleLane)) {
    labels.push("idle");
  }
  if (includesSomeLane(lanes, OffscreenLane)) labels.push("offscreen");
  if (includesSomeLane(lanes, DeferredLane)) labels.push("deferred");
  if (includesSomeLane(lanes, SelectiveHydrationLane)) {
    labels.push("selective-hydration");
  }
  return labels;
}

function appendDevtoolsChildSnapshots<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
  parentId: number,
  inspection: DevtoolsInspectionState,
  children: FigDevtoolsFiberSnapshot[],
): void {
  if (node.tag === ActivityTag && node.type === null) {
    for (let child = node.child; child !== null; child = child.sibling) {
      appendDevtoolsChildSnapshots(child, parentId, inspection, children);
    }
    return;
  }

  children.push(snapshotDevtoolsFiber(node, parentId, inspection));
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

    const kind = hookKindNames[hook.kind];
    if (isEffectHook(hook.kind)) {
      const effect = hook.memoizedState as Effect;
      hooks.push({
        id,
        kind,
        deps: effect.deps,
        phase: devtoolsEffectPhase(effect.phase),
        active: effect.controller !== null,
      });
    } else if (hook.kind === MemoHook) {
      const memo = hook.memoizedState as MemoState<unknown>;
      hooks.push({
        id,
        kind,
        state: memo.value,
        deps: memo.deps,
      });
    } else if (hook.kind === ExternalStoreHook) {
      const store = hook.memoizedState as ExternalStoreState<unknown, unknown>;
      hooks.push({
        id,
        kind,
        state: store.value,
      });
    } else {
      hooks.push({
        id,
        kind,
        state: (hook as Hook<unknown>).memoizedState,
      });
    }
  }

  return hooks;
}

function devtoolsContextDependencies<Container, Instance, TextInstance>(
  node: Fiber<Container, Instance, TextInstance>,
): string[] {
  return (
    node.contextDependencies?.map((dependency) =>
      devtoolsTypeName(dependency.context, "Context"),
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
    localName?: unknown;
    tagName?: unknown;
  } | null;

  return {
    kind: "element",
    tagName:
      typeof instance?.localName === "string"
        ? instance.localName
        : typeof instance?.tagName === "string"
          ? instance.tagName.toLowerCase()
          : String(node.type),
    attributes: {},
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
    case ViewTransitionTag:
      return { kind: "view-transition", name: "ViewTransition" };
    case PortalTag:
      return { kind: "portal", name: "Portal" };
    case AssetsTag:
      return { kind: "assets", name: "Assets" };
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
