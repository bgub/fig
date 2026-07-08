import type { DataResourceKey } from "./data.ts";
import { readPromise } from "./hooks.ts";
import type { ClientReferenceAssets } from "./resource.ts";

export type Key = string | number;
export type Props = Record<string, any>;
export type ElementType<P = Props> =
  | string
  | typeof Fragment
  | FigAssets
  | FigClientReference<P>
  | FigErrorBoundary
  | FigSuspense
  | FigActivity
  | FigViewTransition
  | ((props: P & { children?: FigNode }) => FigNode);
export type FigText = string | number;
export type FigNode =
  | FigElement<any>
  | FigPortal<any>
  | FigText
  | boolean
  | null
  | undefined
  | FigNode[];

export interface FigElement<P = Props> {
  readonly $$typeof: symbol;
  readonly type: ElementType<any>;
  readonly key: Key | null;
  readonly props: P & { children?: FigNode };
}

export interface FigPortal<Target = unknown> {
  readonly $$typeof: symbol;
  readonly children: FigNode;
  readonly key: Key | null;
  readonly target: Target;
}

export interface ClientReferenceOptions {
  assets?: ClientReferenceAssets;
  id: string;
  load: () => Promise<unknown>;
  ssr?: ElementType;
}

export interface FigClientReference<P = Props> {
  (props: P & { children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
  readonly assets?: ClientReferenceAssets;
  readonly id: string;
  readonly load: () => Promise<unknown>;
  readonly ssr?: ElementType;
}

export type LazyLoader<P = Props> = () => PromiseLike<ElementType<P>>;

export interface SuspenseProps {
  fallback?: FigNode;
  children?: FigNode;
}

export interface FigSuspense {
  (props: SuspenseProps): FigNode;
  readonly $$typeof: symbol;
}

export type ActivityMode = "visible" | "hidden";

export interface ActivityProps {
  mode: ActivityMode;
  children?: FigNode;
}

export interface FigActivity {
  (props: ActivityProps): FigNode;
  readonly $$typeof: symbol;
}

export type ViewTransitionClass = "auto" | "none" | (string & {});

export interface ViewTransitionProps {
  name?: string;
  children?: FigNode;
  default?: ViewTransitionClass;
  enter?: ViewTransitionClass;
  exit?: ViewTransitionClass;
  share?: ViewTransitionClass;
  update?: ViewTransitionClass;
}

export interface FigViewTransition {
  (props: ViewTransitionProps): FigNode;
  readonly $$typeof: symbol;
}

export interface ErrorBoundaryProps {
  // A function fallback receives the caught error so error UIs can render
  // it (message, retry affordance) without smuggling state above the
  // boundary through onError. A bare function is never a valid FigNode, so
  // the two shapes cannot collide.
  fallback?: FigNode | ((error: unknown, info: ErrorInfo) => FigNode);
  onError?: (error: unknown, info: ErrorInfo) => void;
  children?: FigNode;
}

export interface ErrorInfo {
  componentStack: string;
  dataResourceKeys?: DataResourceKey[];
}

export interface FigErrorBoundary {
  (props: ErrorBoundaryProps): FigNode;
  readonly $$typeof: symbol;
}

export interface FigAssets {
  (props: Props & { children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
}

export const Fragment = Symbol.for("fig.fragment");
export const FigElementSymbol = Symbol.for("fig.element");
export const FigClientReferenceSymbol = Symbol.for("fig.client-reference");
export const FigActivitySymbol = Symbol.for("fig.activity");
export const FigErrorBoundarySymbol = Symbol.for("fig.error-boundary");
export const FigPortalSymbol = Symbol.for("fig.portal");
export const FigAssetsSymbol = Symbol.for("fig.assets");
export const FigSuspenseSymbol = Symbol.for("fig.suspense");
export const FigViewTransitionSymbol = Symbol.for("fig.view-transition");

export const Assets: FigAssets = Object.assign(
  (props: Props & { children?: FigNode }) => props.children,
  { $$typeof: FigAssetsSymbol },
);

export const ErrorBoundary: FigErrorBoundary = Object.assign(
  (props: ErrorBoundaryProps) => props.children,
  { $$typeof: FigErrorBoundarySymbol },
);

export const Suspense: FigSuspense = Object.assign(
  (props: SuspenseProps) => props.children,
  { $$typeof: FigSuspenseSymbol },
);

export const Activity: FigActivity = Object.assign(
  (props: ActivityProps) => props.children,
  { $$typeof: FigActivitySymbol },
);

export const ViewTransition: FigViewTransition = Object.assign(
  (props: ViewTransitionProps) => props.children,
  { $$typeof: FigViewTransitionSymbol },
);

export function createElement<P extends Props>(
  type: ElementType<P>,
  config?: (P & { key?: Key | null }) | null,
  ...children: FigNode[]
): FigElement<P> {
  const props = { ...config } as P & {
    children?: FigNode;
    key?: Key | null;
  };
  const key = props.key ?? null;
  delete props.key;

  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;

  return { $$typeof: FigElementSymbol, type, key, props };
}

export function isValidElement(value: unknown): value is FigElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as FigElement).$$typeof === FigElementSymbol
  );
}

export function createPortalNode<Target>(
  children: FigNode,
  target: Target,
  key: Key | null = null,
): FigPortal<Target> {
  return { $$typeof: FigPortalSymbol, children, key, target };
}

export function isPortal(value: unknown): value is FigPortal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as FigPortal).$$typeof === FigPortalSymbol
  );
}

export function clientReference<P extends Props>(
  options: ClientReferenceOptions,
): FigClientReference<P> {
  const reference = (() => {
    throw new Error(
      `Client reference "${options.id}" cannot be rendered on the server directly.`,
    );
  }) as unknown as FigClientReference<P>;

  return Object.assign(reference, {
    $$typeof: FigClientReferenceSymbol,
    assets: options.assets,
    id: options.id,
    load: options.load,
    ssr: options.ssr,
  });
}

export function lazy<P extends Props>(
  load: LazyLoader<P>,
): (props: P & { children?: FigNode }) => FigNode {
  let promise: PromiseLike<ElementType<P>> | null = null;
  let rejected = false;

  return function Lazy(props: P & { children?: FigNode }) {
    if (promise === null) {
      rejected = false;
      const next = Promise.resolve(load()).then(
        (value) => value,
        (error) => {
          if (promise === next) rejected = true;
          throw error;
        },
      );
      promise = next;
    }

    try {
      return createElement(readPromise(promise), props);
    } catch (error) {
      if (rejected) {
        promise = null;
        rejected = false;
      }
      throw error;
    }
  };
}

export function isClientReference(value: unknown): value is FigClientReference {
  return (
    typeof value === "function" &&
    (value as FigClientReference).$$typeof === FigClientReferenceSymbol
  );
}

export function isSuspense(value: unknown): value is FigSuspense {
  return (
    typeof value === "function" &&
    (value as FigSuspense).$$typeof === FigSuspenseSymbol
  );
}

export function isActivity(value: unknown): value is FigActivity {
  return (
    typeof value === "function" &&
    (value as FigActivity).$$typeof === FigActivitySymbol
  );
}

export function isErrorBoundary(value: unknown): value is FigErrorBoundary {
  return (
    typeof value === "function" &&
    (value as FigErrorBoundary).$$typeof === FigErrorBoundarySymbol
  );
}

export function isViewTransition(value: unknown): value is FigViewTransition {
  return (
    typeof value === "function" &&
    (value as FigViewTransition).$$typeof === FigViewTransitionSymbol
  );
}

export function isAssets(value: unknown): value is FigAssets {
  return (
    typeof value === "function" &&
    (value as FigAssets).$$typeof === FigAssetsSymbol
  );
}
