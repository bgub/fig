import type { RefreshFamily } from "./refresh.ts";

type RefreshFamilyResolver = (type: unknown) => RefreshFamily | undefined;

let resolveFamily: RefreshFamilyResolver | null = null;
let staleFamilies: Set<RefreshFamily> | null = null;

export function setRefreshHandlerState(
  handler: RefreshFamilyResolver | null,
): void {
  resolveFamily = handler;
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
