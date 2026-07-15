import { type ElementType, type FigContext, Fragment } from "@bgub/fig";
import type { FigDevtoolsGlobalHook } from "./devtools.ts";

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
