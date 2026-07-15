import type { DependencyList, ElementType, FigContext, Props } from "@bgub/fig";
import type { DataStoreEntrySnapshot } from "@bgub/fig/internal";
import {
  devtoolsTypeName,
  getFigDevtoolsGlobalHook,
} from "./devtools-internal.ts";
import type {
  FigDevtoolsCommitInspection,
  FigDevtoolsEffectPhase,
  FigDevtoolsFiberKind,
  FigDevtoolsFiberSnapshot,
  FigDevtoolsHookSnapshot,
  FigDevtoolsHostSnapshot,
  FigDevtoolsRootSnapshot,
  FigDevtoolsWorkLabel,
} from "./devtools.ts";
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
  type Tag,
  TextTag,
  ViewTransitionTag,
} from "./fiber-tags.ts";
import {
  BeforeLayoutEffect,
  BeforePaintEffect,
  type EffectPhase,
  ExternalStoreHook,
  hookKindNames,
  type HookKind,
  isEffectHook,
  MemoHook,
} from "./hook-kinds.ts";
import {
  AllTransitionLanes,
  DefaultHydrationLane,
  DefaultLane,
  DeferredLane,
  GestureLane,
  IdleHydrationLane,
  IdleLane,
  InputContinuousHydrationLane,
  InputContinuousLane,
  includesSomeLane,
  type Lanes,
  OffscreenLane,
  RetryLanes,
  SelectiveHydrationLane,
  SyncHydrationLane,
  SyncLane,
  TransitionHydrationLane,
} from "./lanes.ts";
import { now } from "./scheduler.ts";

interface DevtoolsHook {
  kind: HookKind;
  memoizedState: unknown;
  next: DevtoolsHook | null;
}

interface DevtoolsContextDependency {
  context: FigContext<unknown>;
}

interface DevtoolsErrorBoundaryState {
  error: unknown;
  info: { componentStack: string };
}

interface DevtoolsFiber {
  tag: Tag;
  type: ElementType | FigContext<unknown> | null;
  key: string | number | null;
  index: number;
  props: Props;
  memoizedProps: Props | null;
  memoizedState: DevtoolsHook | null;
  stateNode: unknown;
  boundaryState: unknown;
  child: DevtoolsFiber | null;
  sibling: DevtoolsFiber | null;
  alternate: DevtoolsFiber | null;
  lanes: Lanes;
  childLanes: Lanes;
  contextDependencies: DevtoolsContextDependency[] | null;
}

interface DevtoolsRoot {
  current: DevtoolsFiber;
  dataStore: {
    inspectDataDependencyCanonicalKeys(owner: object): string[];
    inspectDataEntries(): DataStoreEntrySnapshot[];
  };
  pendingLanes: Lanes;
  suspendedLanes: Lanes;
  pingedLanes: Lanes;
  expiredLanes: Lanes;
}

interface DevtoolsInspectionState {
  hostFibers: WeakMap<object, number>;
  fiberElements: Map<number, object>;
}

const devtoolsFiberIds = new WeakMap<object, number>();
const devtoolsRootIds = new WeakMap<object, number>();
const devtoolsRendererIds = new WeakMap<object, number>();
let nextDevtoolsFiberId = 1;
let nextDevtoolsRootId = 1;

export function emitDevtoolsCommit(renderer: object, root: DevtoolsRoot): void {
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

function snapshotDevtoolsRoot(
  root: DevtoolsRoot,
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
    tree: snapshotDevtoolsFiber(root.current, null, root.dataStore, inspection),
  };
}

function snapshotDevtoolsFiber(
  node: DevtoolsFiber,
  parentId: number | null,
  dataStore: DevtoolsRoot["dataStore"],
  inspection: DevtoolsInspectionState,
): FigDevtoolsFiberSnapshot {
  const id = devtoolsFiberId(node);
  const { kind, name } = devtoolsFiberInfo(node);
  const children: FigDevtoolsFiberSnapshot[] = [];
  const errorState = devtoolsErrorBoundaryState(node);
  recordDevtoolsHostFiber(node, id, inspection);

  for (let child = node.child; child !== null; child = child.sibling) {
    appendDevtoolsChildSnapshots(child, id, dataStore, inspection, children);
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
    dataResourceCanonicalKeys: devtoolsDataResourceKeys(node, dataStore),
    host: devtoolsHost(node),
    capturedError: errorState?.error,
    componentStack: errorState?.info.componentStack,
    children,
  };
}

function devtoolsErrorBoundaryState(
  node: DevtoolsFiber,
): DevtoolsErrorBoundaryState | null {
  return node.tag === ErrorBoundaryTag
    ? (node.boundaryState as DevtoolsErrorBoundaryState | null)
    : null;
}

function devtoolsWorkLabels(lanes: Lanes): FigDevtoolsWorkLabel[] {
  const labels: FigDevtoolsWorkLabel[] = [];
  if (includesSomeLane(lanes, SyncHydrationLane | SyncLane)) {
    labels.push("sync");
  }
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

function devtoolsDataResourceKeys(
  node: DevtoolsFiber,
  dataStore: DevtoolsRoot["dataStore"],
): string[] {
  const keys = dataStore.inspectDataDependencyCanonicalKeys(node);
  if (keys.length > 0 || node.alternate === null) return keys;
  // Committed reads live on whichever generation rendered last: every render
  // marks the fiber dirty, so commit migrates the keys onto the committing
  // generation and clears the other. A fiber cloned by a parent update that
  // then bails out never re-reads, leaving its keys on the previous
  // generation — at most one of the pair ever holds them.
  return dataStore.inspectDataDependencyCanonicalKeys(node.alternate);
}

function appendDevtoolsChildSnapshots(
  node: DevtoolsFiber,
  parentId: number,
  dataStore: DevtoolsRoot["dataStore"],
  inspection: DevtoolsInspectionState,
  children: FigDevtoolsFiberSnapshot[],
): void {
  if (node.tag === ActivityTag && node.type === null) {
    for (let child = node.child; child !== null; child = child.sibling) {
      appendDevtoolsChildSnapshots(
        child,
        parentId,
        dataStore,
        inspection,
        children,
      );
    }
    return;
  }

  children.push(snapshotDevtoolsFiber(node, parentId, dataStore, inspection));
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
  return { hostFibers: new WeakMap(), fiberElements: new Map() };
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
    elementForFiber(fiberId) {
      return inspection.fiberElements.get(fiberId) ?? null;
    },
  };
}

function recordDevtoolsHostFiber(
  node: DevtoolsFiber,
  id: number,
  inspection: DevtoolsInspectionState,
): void {
  if (node.tag !== HostTag && node.tag !== TextTag) return;
  if (typeof node.stateNode !== "object" || node.stateNode === null) return;
  inspection.hostFibers.set(node.stateNode, id);
  inspection.fiberElements.set(id, node.stateNode);
}

function devtoolsFiberId(node: DevtoolsFiber): number {
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

function devtoolsProps(node: DevtoolsFiber): Props {
  const props: Props = {};
  const source = node.memoizedProps ?? node.props;

  for (const [key, value] of Object.entries(source)) {
    if (key !== "children") props[key] = value;
  }

  return props;
}

function devtoolsHooks(
  firstHook: DevtoolsHook | null,
): FigDevtoolsHookSnapshot[] {
  const hooks: FigDevtoolsHookSnapshot[] = [];
  let id = 0;

  for (let hook = firstHook; hook !== null; hook = hook.next) {
    id += 1;

    const kind = hookKindNames[hook.kind];
    if (isEffectHook(hook.kind)) {
      const effect = hook.memoizedState as {
        controller: AbortController | null;
        deps: DependencyList | null;
        phase: EffectPhase;
      };
      hooks.push({
        id,
        kind,
        deps: effect.deps,
        phase: devtoolsEffectPhase(effect.phase),
        active: effect.controller !== null,
      });
    } else if (hook.kind === MemoHook) {
      const memo = hook.memoizedState as {
        deps: DependencyList;
        value: unknown;
      };
      hooks.push({ id, kind, state: memo.value, deps: memo.deps });
    } else if (hook.kind === ExternalStoreHook) {
      const store = hook.memoizedState as { value: unknown };
      hooks.push({ id, kind, state: store.value });
    } else {
      hooks.push({ id, kind, state: hook.memoizedState });
    }
  }

  return hooks;
}

function devtoolsContextDependencies(node: DevtoolsFiber): string[] {
  return (
    node.contextDependencies?.map((dependency) =>
      devtoolsTypeName(dependency.context, "Context"),
    ) ?? []
  );
}

function devtoolsHost(
  node: DevtoolsFiber,
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

function devtoolsFiberInfo(node: DevtoolsFiber): {
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
