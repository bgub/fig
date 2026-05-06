import {
  type DependencyList,
  type ElementType,
  type FigContext,
  Fragment,
  type Props,
} from "@bgub/fig";
import type { Lanes } from "./lanes.ts";

export type FigDevtoolsFiberKind =
  | "root"
  | "host"
  | "text"
  | "function"
  | "fragment"
  | "context-provider"
  | "error-boundary"
  | "portal";

export type FigDevtoolsHookKind =
  | "state"
  | "external-store"
  | "memo"
  | "reactive"
  | "on-mount"
  | "before-paint"
  | "before-layout";

export type FigDevtoolsEffectPhase =
  | "reactive"
  | "before-paint"
  | "before-layout";

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
  lanes: Lanes;
  childLanes: Lanes;
  hooks: FigDevtoolsHookSnapshot[];
  contextDependencies: string[];
  capturedError?: unknown;
  componentStack?: string;
  children: FigDevtoolsFiberSnapshot[];
}

export interface FigDevtoolsRootSnapshot {
  id: number;
  rendererId: number;
  committedAt: number;
  pendingLanes: Lanes;
  suspendedLanes: Lanes;
  pingedLanes: Lanes;
  expiredLanes: Lanes;
  tree: FigDevtoolsFiberSnapshot;
}

export interface FigDevtoolsRendererInfo {
  name: string;
  packageName: string;
}

export interface FigDevtoolsGlobalHook {
  inject(renderer: FigDevtoolsRendererInfo): number;
  onCommitRoot(rendererId: number, snapshot: FigDevtoolsRootSnapshot): void;
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
