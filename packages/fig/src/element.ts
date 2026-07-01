import { readPromise } from "./hooks.ts";
import type { DataResourceKey } from "./data.ts";
import type { ClientReferenceResources } from "./resource.ts";

export type Key = string | number;
export type Props = Record<string, any>;
export type ElementType<P = Props> =
  | string
  | typeof Fragment
  | FigResources
  | FigClientReference<P>
  | FigErrorBoundary
  | FigSuspense
  | FigActivity
  | ((props: P & { children?: FigNode }) => FigNode);
export type FigText = string | number;
export type FigChild =
  | FigElement<any>
  | FigPortal<any>
  | FigText
  | boolean
  | null
  | undefined
  | FigChild[];
export type FigNode = FigChild;

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
  id: string;
  load: () => Promise<unknown>;
  resources?: ClientReferenceResources;
  ssr?: ElementType;
}

export interface FigClientReference<P = Props> {
  (props: P & { children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
  readonly id: string;
  readonly load: () => Promise<unknown>;
  readonly resources?: ClientReferenceResources;
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

export interface ErrorBoundaryProps {
  fallback?: FigNode;
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

export interface FigResources {
  (props: Props & { children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
}

export const Fragment = Symbol.for("fig.fragment");
export const FigElementSymbol = Symbol.for("fig.element");
export const FigClientReferenceSymbol = Symbol.for("fig.client-reference");
export const FigActivitySymbol = Symbol.for("fig.activity");
export const FigErrorBoundarySymbol = Symbol.for("fig.error-boundary");
export const FigPortalSymbol = Symbol.for("fig.portal");
export const FigResourcesSymbol = Symbol.for("fig.resources");
export const FigSuspenseSymbol = Symbol.for("fig.suspense");

export const Resources: FigResources = Object.assign(
  (props: Props & { children?: FigNode }) => props.children,
  { $$typeof: FigResourcesSymbol },
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
    id: options.id,
    load: options.load,
    resources: options.resources,
    ssr: options.ssr,
  });
}

export function lazy<P extends Props>(
  load: LazyLoader<P>,
): (props: P & { children?: FigNode }) => FigNode {
  let promise: PromiseLike<ElementType<P>> | null = null;

  return function Lazy(props: P & { children?: FigNode }) {
    return createElement(readPromise((promise ??= load())), props);
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

export function isResources(value: unknown): value is FigResources {
  return (
    typeof value === "function" &&
    (value as FigResources).$$typeof === FigResourcesSymbol
  );
}
