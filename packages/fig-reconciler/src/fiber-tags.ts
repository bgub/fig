import { type FigElement, Fragment } from "@bgub/fig";
import {
  isActivity,
  isAssets,
  isContext,
  isErrorBoundary,
  isSuspense,
  isViewTransition,
} from "@bgub/fig/internal";

export const RootTag = 0;
export const HostTag = 1;
export const TextTag = 2;
export const FunctionTag = 3;
export const FragmentTag = 4;
export const ContextProviderTag = 5;
export const SuspenseTag = 6;
export const ErrorBoundaryTag = 7;
export const PortalTag = 8;
export const AssetsTag = 9;
export const ActivityTag = 10;
export const ViewTransitionTag = 11;

export type Tag =
  | typeof RootTag
  | typeof HostTag
  | typeof TextTag
  | typeof FunctionTag
  | typeof FragmentTag
  | typeof ContextProviderTag
  | typeof SuspenseTag
  | typeof ErrorBoundaryTag
  | typeof PortalTag
  | typeof AssetsTag
  | typeof ActivityTag
  | typeof ViewTransitionTag;

export function tagFor(element: FigElement): Tag {
  if (typeof element.type === "string") return HostTag;
  if (element.type === Fragment) return FragmentTag;
  if (isAssets(element.type)) return AssetsTag;
  if (isContext(element.type)) return ContextProviderTag;
  if (isSuspense(element.type)) return SuspenseTag;
  if (isActivity(element.type)) return ActivityTag;
  if (isErrorBoundary(element.type)) return ErrorBoundaryTag;
  if (isViewTransition(element.type)) return ViewTransitionTag;
  return FunctionTag;
}
