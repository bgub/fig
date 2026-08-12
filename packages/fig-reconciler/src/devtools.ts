/**
 * Public snapshot and hook contracts for Fig DevTools integrations.
 *
 * @module
 */
import type { DependencyList, Props } from "@bgub/fig";
import type { DataStoreEntrySnapshot } from "@bgub/fig/internal";

/** Describes Fig DevTools fiber kind. */
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

/** Describes Fig DevTools hook kind. */
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

/** Describes Fig DevTools effect phase. */
export type FigDevtoolsEffectPhase =
  | "reactive"
  | "before-paint"
  | "before-layout";

/** Describes Fig DevTools work label. */
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

/** Describes Fig DevTools hook snapshot. */
export interface FigDevtoolsHookSnapshot {
  id: number;
  kind: FigDevtoolsHookKind;
  state?: unknown;
  deps?: DependencyList | null;
  phase?: FigDevtoolsEffectPhase;
  active?: boolean;
}

/** Describes Fig DevTools fiber snapshot. */
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

/** Describes Fig DevTools host snapshot. */
export interface FigDevtoolsHostSnapshot {
  kind: "element" | "text";
  tagName?: string;
  attributes?: Record<string, string>;
  text?: string;
}

/** Describes Fig DevTools root snapshot. */
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

/** Describes Fig DevTools element inspection. */
export interface FigDevtoolsElementInspection {
  rootId: number;
  fiberId: number;
}

/** Describes Fig DevTools commit inspection. */
export interface FigDevtoolsCommitInspection {
  inspectElement(target: unknown): FigDevtoolsElementInspection | null;
  elementForFiber(fiberId: number): unknown;
}

/** Describes Fig DevTools renderer info. */
export interface FigDevtoolsRendererInfo {
  name: string;
  packageName: string;
}

/** Describes Fig DevTools global hook. */
export interface FigDevtoolsGlobalHook {
  inject(renderer: FigDevtoolsRendererInfo): number;
  onCommitRoot(
    rendererId: number,
    snapshot: FigDevtoolsRootSnapshot,
    inspection?: FigDevtoolsCommitInspection,
  ): void;
}
