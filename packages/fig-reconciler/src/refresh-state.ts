import type { RefreshFamily } from "./refresh.ts";

type RefreshFamilyResolver = (type: unknown) => RefreshFamily | undefined;

let resolveFamily: RefreshFamilyResolver | null = null;

export function getRefreshHandler(): RefreshFamilyResolver | null {
  return resolveFamily;
}

export function setRefreshHandlerState(
  handler: RefreshFamilyResolver | null,
): void {
  resolveFamily = handler;
}
