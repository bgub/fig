import type {
  RefreshAdapter,
  RefreshFamily,
  RefreshUpdate,
} from "@bgub/fig-reconciler/refresh";

// The Fig Fast Refresh runtime. A bundler transform (dev only) registers each
// component version under a stable id and records its hook signature, then calls
// performRefresh() from an import.meta.hot.accept handler. The runtime groups
// versions into families, decides which can re-render in place vs must remount,
// and drives the reconciler.

interface Signature {
  forceReset: boolean;
  key: string;
}

const familiesByType = new WeakMap<object, RefreshFamily>();
const familiesById = new Map<string, RefreshFamily>();
const signatures = new WeakMap<object, Signature>();
const renderers = new Set<RefreshAdapter>();
const unscheduledRefreshes: RefreshUpdate[] = [];
let pendingUpdates: Array<[RefreshFamily, object]> = [];

function asKey(type: unknown): object | null {
  if (typeof type === "function") return type;
  return typeof type === "object" && type !== null ? type : null;
}

function resolveFamilyByType(type: unknown): RefreshFamily | undefined {
  const key = asKey(type);
  return key === null ? undefined : familiesByType.get(key);
}

// Register a component version under a stable id (e.g. "src/App.tsx#App"). The
// first version creates a family; later versions of the same id queue an update.
export function register(type: unknown, id: string): void {
  const key = asKey(type);
  if (key === null || familiesByType.has(key)) return;

  let family = familiesById.get(id);
  if (family === undefined) {
    family = { current: type };
    familiesById.set(id, family);
  } else {
    pendingUpdates.push([family, key]);
  }
  familiesByType.set(key, family);
}

// Record a component's hook signature. Differing signatures between versions
// (or forceReset) mean a remount; identical signatures re-render in place.
export function setSignature(
  type: unknown,
  key: string,
  forceReset = false,
): void {
  const target = asKey(type);
  if (target !== null) signatures.set(target, { forceReset, key });
}

// Connect the runtime to a renderer-owned reconciler. The adapter installs the
// family resolver and schedules updates through the same reconciler instance.
export function injectRenderer(renderer: RefreshAdapter): void {
  if (renderers.has(renderer)) return;

  renderer.setRefreshHandler(resolveFamilyByType);
  renderers.add(renderer);
  for (const update of unscheduledRefreshes) {
    renderer.scheduleRefresh(update);
  }
  unscheduledRefreshes.length = 0;
}

// Apply queued registrations: advance each family to its newest version, bucket
// it as updated (re-render in place) or stale (remount), and drive the renderers.
export function performRefresh(): RefreshUpdate | null {
  if (pendingUpdates.length === 0) return null;

  const updates = pendingUpdates;
  pendingUpdates = [];

  const updatedFamilies = new Set<RefreshFamily>();
  const staleFamilies = new Set<RefreshFamily>();

  for (const [family, nextType] of updates) {
    const prevType = family.current;
    family.current = nextType;
    if (isSignatureStale(prevType, nextType)) staleFamilies.add(family);
    else updatedFamilies.add(family);
  }

  // If a family was edited more than once and any edit was stale, prefer remount.
  for (const family of staleFamilies) updatedFamilies.delete(family);

  const update: RefreshUpdate = { staleFamilies, updatedFamilies };
  if (renderers.size === 0) {
    unscheduledRefreshes.push(update);
    return update;
  }
  for (const renderer of renderers) renderer.scheduleRefresh(update);
  return update;
}

function isSignatureStale(prevType: unknown, nextType: unknown): boolean {
  const prevKey = asKey(prevType);
  const nextKey = asKey(nextType);
  const prev = prevKey === null ? undefined : signatures.get(prevKey);
  const next = nextKey === null ? undefined : signatures.get(nextKey);

  if (next?.forceReset === true) return true;
  // Neither version recorded a signature: treat as a safe in-place update.
  if (prev === undefined && next === undefined) return false;
  // One has a signature and the other doesn't, or the keys differ: remount.
  if (prev === undefined || next === undefined) return true;
  return prev.key !== next.key;
}
