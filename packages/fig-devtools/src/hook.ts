import type {
  FigDevtoolsCommitInspection,
  FigDevtoolsElementInspection,
  FigDevtoolsFiberSnapshot,
  FigDevtoolsGlobalHook,
  FigDevtoolsRendererInfo,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler";

export const FIG_DEVTOOLS_HOOK_KEY = "__FIG_DEVTOOLS_GLOBAL_HOOK__";

export interface FigDevtoolsHook extends FigDevtoolsGlobalHook {
  renderers: Map<number, FigDevtoolsRendererInfo>;
  roots: Map<number, FigDevtoolsRootSnapshot>;
  commits: FigDevtoolsCommitSnapshot[];
  revision: number;
  subscribe(listener: FigDevtoolsListener): () => void;
  clear(): void;
  inspectElement(target: unknown): FigDevtoolsElementInspection | null;
}

export interface FigDevtoolsCommitSnapshot {
  id: number;
  rendererId: number;
  rootId: number;
  committedAt: number;
  tree: FigDevtoolsFiberSnapshot;
  root: FigDevtoolsRootSnapshot;
}

export type FigDevtoolsListener = () => void;

export interface FigDevtoolsHookOptions {
  maxEntries?: number;
}

export type FigDevtoolsGlobalTarget = typeof globalThis & {
  [FIG_DEVTOOLS_HOOK_KEY]?: unknown;
};

const DefaultMaxEntries = 100;
const MinMaxEntries = 20;
const MaxMaxEntries = 500;

export function createFigDevtoolsGlobalHook(
  options: FigDevtoolsHookOptions = {},
): FigDevtoolsHook {
  const renderers = new Map<number, FigDevtoolsRendererInfo>();
  const roots = new Map<number, FigDevtoolsRootSnapshot>();
  const commits: FigDevtoolsCommitSnapshot[] = [];
  const inspections = new Map<number, FigDevtoolsCommitInspection>();
  const listeners = new Set<FigDevtoolsListener>();
  const maxEntries = clampMaxEntries(options.maxEntries);
  let nextRendererId = 1;
  let nextCommitId = 1;
  let revision = 0;

  const notify = () => {
    revision += 1;
    for (const listener of listeners) listener();
  };

  return {
    renderers,
    roots,
    commits,
    get revision() {
      return revision;
    },
    inject(renderer) {
      const id = nextRendererId;
      nextRendererId += 1;
      renderers.set(id, renderer);
      notify();
      return id;
    },
    onCommitRoot(rendererId, snapshot, inspection) {
      roots.set(snapshot.id, snapshot);
      if (inspection === undefined) inspections.delete(snapshot.id);
      else inspections.set(snapshot.id, inspection);
      commits.push({
        id: nextCommitId,
        rendererId,
        rootId: snapshot.id,
        committedAt: snapshot.committedAt,
        tree: snapshot.tree,
        root: snapshot,
      });
      nextCommitId += 1;

      while (commits.length > maxEntries) commits.shift();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      commits.length = 0;
      notify();
    },
    inspectElement(target) {
      return inspectElement(target, roots, inspections);
    },
  };
}

export function ensureFigDevtoolsGlobalHook(
  target: FigDevtoolsGlobalTarget = globalThis,
): FigDevtoolsHook {
  const current = target[FIG_DEVTOOLS_HOOK_KEY];
  if (isFigDevtoolsHook(current)) return current;

  const hook = createFigDevtoolsGlobalHook();
  target[FIG_DEVTOOLS_HOOK_KEY] = hook;
  return hook;
}

export function isFigDevtoolsHook(value: unknown): value is FigDevtoolsHook {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<FigDevtoolsHook>;
  return (
    candidate.renderers instanceof Map &&
    candidate.roots instanceof Map &&
    Array.isArray(candidate.commits) &&
    typeof candidate.revision === "number" &&
    typeof candidate.inject === "function" &&
    typeof candidate.onCommitRoot === "function" &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.inspectElement === "function"
  );
}

function inspectElement(
  target: unknown,
  roots: Map<number, FigDevtoolsRootSnapshot>,
  inspections: Map<number, FigDevtoolsCommitInspection>,
): FigDevtoolsElementInspection | null {
  let cursor = isInspectableObject(target) ? target : null;
  const rootIds = [...roots.values()]
    .sort((left, right) => right.committedAt - left.committedAt)
    .map((root) => root.id);

  while (cursor !== null) {
    for (const rootId of rootIds) {
      const inspected = inspections.get(rootId)?.inspectElement(cursor);
      if (inspected !== undefined && inspected !== null) return inspected;
    }

    cursor = isInspectableObject(cursor.parentNode) ? cursor.parentNode : null;
  }

  return null;
}

function isInspectableObject(
  value: unknown,
): value is { parentNode?: unknown } & object {
  return typeof value === "object" && value !== null;
}

function clampMaxEntries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DefaultMaxEntries;
  return Math.min(MaxMaxEntries, Math.max(MinMaxEntries, Math.trunc(value)));
}
