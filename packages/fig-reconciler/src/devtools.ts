import type { DependencyList, Props } from "@bgub/fig";
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
  dataResourceCanonicalKeys: string[];
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
