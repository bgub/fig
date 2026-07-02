declare const process: { env: { NODE_ENV?: string } };

// A family groups every version of a component across hot edits; `current` is
// the latest implementation. The handler is module-global (one refresh runtime
// per app) so module-level reconcile helpers can consult it. In production no
// handler is ever set, so all of this collapses to identity/equality paths.
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
  if (process.env.NODE_ENV !== "production") {
    resolveFamily = handler;
  }
}

export function hasRefreshHandler(): boolean {
  return resolveFamily !== null;
}

export function refreshFamilyFor(type: unknown): RefreshFamily | undefined {
  return resolveFamily?.(type);
}

export function resolveLatestType(type: unknown): unknown {
  const family = resolveFamily?.(type);
  return family === undefined ? type : family.current;
}

export function runWithStaleRefreshFamilies<T>(
  families: Set<RefreshFamily>,
  callback: () => T,
): T {
  staleFamilies = families;
  try {
    return callback();
  } finally {
    staleFamilies = null;
  }
}

export function matchesComponentFamily(
  fiberType: unknown,
  childType: unknown,
): boolean {
  const family = resolveFamily?.(fiberType);
  if (family === undefined) return fiberType === childType;
  if (family !== resolveFamily?.(childType)) return false;
  return staleFamilies === null || !staleFamilies.has(family);
}
