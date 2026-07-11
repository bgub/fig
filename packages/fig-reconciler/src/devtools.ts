import {
  type DependencyList,
  type ElementType,
  type FigContext,
  Fragment,
  type Props,
} from "@bgub/fig";
import type { DataStoreEntrySnapshot } from "@bgub/fig/internal";

export type FigDevtoolsFiberKind =
  | "root"
  | "host"
  | "text"
  | "function"
  | "fragment"
  | "assets"
  | "context-provider"
  | "suspense"
  | "error-boundary"
  | "portal"
  | "activity"
  | "view-transition";

export type FigDevtoolsHookKind =
  | "state"
  | "action-state"
  | "id"
  | "deferred-value"
  | "external-store"
  | "memo"
  | "transition"
  | "stable-event"
  | "reactive"
  | "before-paint"
  | "before-layout";

export type FigDevtoolsEffectPhase =
  | "reactive"
  | "before-paint"
  | "before-layout";

export type FigDevtoolsWorkLabel =
  | "sync"
  | "input"
  | "default"
  | "gesture"
  | "transition"
  | "retry"
  | "idle"
  | "offscreen"
  | "deferred"
  | "selective-hydration";

export interface FigDevtoolsHookSnapshot {
  id: number;
  kind: FigDevtoolsHookKind;
  state?: unknown;
  deps?: DependencyList | null;
  phase?: FigDevtoolsEffectPhase;
  active?: boolean;
}

export interface FigDevtoolsFiberSnapshot {
  id: number;
  parentId: number | null;
  name: string;
  kind: FigDevtoolsFiberKind;
  key: string | number | null;
  index: number;
  props: Props;
  pendingWork: FigDevtoolsWorkLabel[];
  childWork: FigDevtoolsWorkLabel[];
  hooks: FigDevtoolsHookSnapshot[];
  contextDependencies: string[];
  host?: FigDevtoolsHostSnapshot;
  capturedError?: unknown;
  componentStack?: string;
  children: FigDevtoolsFiberSnapshot[];
}

export interface FigDevtoolsHostSnapshot {
  kind: "element" | "text";
  tagName?: string;
  attributes?: Record<string, string>;
  text?: string;
}

export interface FigDevtoolsRootSnapshot {
  id: number;
  rendererId: number;
  committedAt: number;
  dataResources: DataStoreEntrySnapshot[];
  pendingWork: FigDevtoolsWorkLabel[];
  suspendedWork: FigDevtoolsWorkLabel[];
  pingedWork: FigDevtoolsWorkLabel[];
  expiredWork: FigDevtoolsWorkLabel[];
  tree: FigDevtoolsFiberSnapshot;
}

export interface FigDevtoolsElementInspection {
  rootId: number;
  fiberId: number;
}

export interface FigDevtoolsCommitInspection {
  inspectElement(target: unknown): FigDevtoolsElementInspection | null;
  elementForFiber(fiberId: number): unknown;
}

export interface FigDevtoolsRendererInfo {
  name: string;
  packageName: string;
}

export interface FigDevtoolsGlobalHook {
  inject(renderer: FigDevtoolsRendererInfo): number;
  onCommitRoot(
    rendererId: number,
    snapshot: FigDevtoolsRootSnapshot,
    inspection?: FigDevtoolsCommitInspection,
  ): void;
}

export function devtoolsTypeName(
  type: ElementType | FigContext<unknown> | null,
  fallback: string,
): string {
  if (typeof type === "string") return type;
  if (type === Fragment) return "Fragment";
  if (typeof type !== "function") return fallback;

  const namedType = type as {
    displayName?: unknown;
    name?: unknown;
  };

  if (typeof namedType.displayName === "string" && namedType.displayName !== "")
    return namedType.displayName;
  if (typeof namedType.name === "string" && namedType.name !== "")
    return namedType.name;

  return fallback;
}

export function getFigDevtoolsGlobalHook(): FigDevtoolsGlobalHook | null {
  const globalWithHook = globalThis as typeof globalThis & {
    __FIG_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  };
  const hook = globalWithHook.__FIG_DEVTOOLS_GLOBAL_HOOK__;

  if (
    typeof hook !== "object" ||
    hook === null ||
    !("inject" in hook) ||
    !("onCommitRoot" in hook)
  ) {
    return null;
  }

  const candidate = hook as Partial<FigDevtoolsGlobalHook>;
  if (
    typeof candidate.inject !== "function" ||
    typeof candidate.onCommitRoot !== "function"
  ) {
    return null;
  }

  return candidate as FigDevtoolsGlobalHook;
}
