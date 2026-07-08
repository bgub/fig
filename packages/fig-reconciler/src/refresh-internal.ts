import type { RefreshFamily } from "./refresh.ts";
import { getRefreshHandler } from "./refresh-state.ts";

let staleFamilies: Set<RefreshFamily> | null = null;

export function hasRefreshHandler(): boolean {
  return getRefreshHandler() !== null;
}

export function refreshFamilyFor(type: unknown): RefreshFamily | undefined {
  return getRefreshHandler()?.(type);
}

export function resolveLatestType(type: unknown): unknown {
  const family = getRefreshHandler()?.(type);
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
  const resolveFamily = getRefreshHandler();
  const family = resolveFamily?.(fiberType);
  if (family === undefined) return fiberType === childType;
  if (family !== resolveFamily?.(childType)) return false;
  return staleFamilies === null || !staleFamilies.has(family);
}
