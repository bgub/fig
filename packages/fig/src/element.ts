import type { DataResourceKey } from "./data.ts";
import { readPromise } from "./hooks.ts";
import type { ClientReferenceAssets } from "./resource.ts";
import { resolveHostMix } from "./mixin.ts";

/** Describes key. */
export type Key = string | number;
/** Describes props. */
export type Props = Record<string, any>;
/** Describes component type. */
export type ComponentType<P = Props> = (
  props: P & { children?: FigNode },
) => FigNode;
/** Describes component props. */
export type ComponentProps<T extends ComponentType<any>> =
  Parameters<T> extends [infer P, ...unknown[]]
    ? P extends Props
      ? P
      : Props
    : {};
/** Describes element type. */
export type ElementType<P = Props> =
  | string
  | typeof Fragment
  | FigAssets
  | FigClientReference<P>
  | FigErrorBoundary
  | FigSuspense
  | FigActivity
  | FigViewTransition
  | ComponentType<P>;
/** Describes awaited Fig node. */
export type AwaitedFigNode =
  | FigElement<any>
  | FigPortal<any>
  | string
  | number
  | boolean
  | null
  | undefined
  | FigNode[];
/** Describes Fig node. */
export type FigNode = AwaitedFigNode | PromiseLike<AwaitedFigNode>;

/** Describes Fig element. */
export interface FigElement<P = Props> {
  readonly $$typeof: symbol;
  readonly type: ElementType<any>;
  readonly key: Key | null;
  readonly props: P & { children?: FigNode };
}

/** Describes Fig portal. */
export interface FigPortal<Target = unknown> {
  readonly $$typeof: symbol;
  readonly children: FigNode;
  readonly key: Key | null;
  readonly target: Target;
}

/** Describes client reference options. */
export interface ClientReferenceOptions<P extends Props = Props> {
  assets?: ClientReferenceAssets;
  id: string;
  ssr?: ComponentType<P>;
}

/** Describes Fig client reference. */
export interface FigClientReference<P = Props> {
  (props: P & { children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
  readonly assets?: ClientReferenceAssets;
  readonly id: string;
  readonly ssr?: ComponentType<P>;
}

/** Describes lazy loader. */
export type LazyLoader<T extends ComponentType<any> = ComponentType<any>> =
  () => PromiseLike<T>;

/** Describes suspense props. */
export interface SuspenseProps {
  fallback?: FigNode;
  children?: FigNode;
}

/** Describes Fig suspense. */
export interface FigSuspense {
  (props: SuspenseProps): FigNode;
  readonly $$typeof: symbol;
}

/** Describes activity mode. */
export type ActivityMode = "visible" | "hidden";

/** Describes activity props. */
export interface ActivityProps {
  mode: ActivityMode;
  children?: FigNode;
}

/** Describes Fig activity. */
export interface FigActivity {
  (props: ActivityProps): FigNode;
  readonly $$typeof: symbol;
}

/** Describes view transition class. */
export type ViewTransitionClass = "auto" | "none" | (string & {});

/** Describes view transition phase. */
export type ViewTransitionPhase = "enter" | "exit" | "share" | "update";

// Renderer-neutral identity for one named host surface in the native
// transition. Renderer packages can resolve it into their own imperative
// handles without putting host types in core.
/** Describes view transition surface. */
export interface ViewTransitionSurface {
  readonly name: string;
}

/** Describes view transition event. */
export interface ViewTransitionEvent {
  readonly phase: ViewTransitionPhase;
  readonly surfaces: readonly ViewTransitionSurface[];
  readonly types: readonly string[];
}

/** Describes view transition callback. */
export type ViewTransitionCallback = (
  event: ViewTransitionEvent,
  signal: AbortSignal,
) => undefined;

/** Describes view transition props. */
export interface ViewTransitionProps {
  name?: string;
  children?: FigNode;
  default?: ViewTransitionClass;
  enter?: ViewTransitionClass;
  exit?: ViewTransitionClass;
  share?: ViewTransitionClass;
  update?: ViewTransitionClass;
  onTransition?: ViewTransitionCallback;
}

/** Describes Fig view transition. */
export interface FigViewTransition {
  (props: ViewTransitionProps): FigNode;
  readonly $$typeof: symbol;
}

/** Describes error boundary props. */
export interface ErrorBoundaryProps {
  // A function fallback receives the caught error so error UIs can render
  // it (message, retry affordance) without smuggling state above the
  // boundary through onError. Callable thenables are nodes, so the runtime
  // distinguishes them from render fallbacks before invoking the function.
  fallback?: FigNode | ((error: unknown, info: ErrorInfo) => FigNode);
  onError?: (error: unknown, info: ErrorInfo) => void;
  children?: FigNode;
}

/** Describes error info. */
export interface ErrorInfo {
  componentStack: string;
  dataResourceKeys?: DataResourceKey[];
}

/** Describes Fig error boundary. */
export interface FigErrorBoundary {
  (props: ErrorBoundaryProps): FigNode;
  readonly $$typeof: symbol;
}

/** Describes Fig assets. */
export interface FigAssets {
  (props: Props & { children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
}

/** The fragment. */
export const Fragment = Symbol.for("fig.fragment");
/** The Fig element symbol. */
export const FigElementSymbol = Symbol.for("fig.element");
/** The Fig client reference symbol. */
export const FigClientReferenceSymbol = Symbol.for("fig.client-reference");
/** The Fig activity symbol. */
export const FigActivitySymbol = Symbol.for("fig.activity");
/** The Fig error boundary symbol. */
export const FigErrorBoundarySymbol = Symbol.for("fig.error-boundary");
/** The Fig portal symbol. */
export const FigPortalSymbol = Symbol.for("fig.portal");
/** The Fig assets symbol. */
export const FigAssetsSymbol = Symbol.for("fig.assets");
/** The Fig suspense symbol. */
export const FigSuspenseSymbol = Symbol.for("fig.suspense");
/** The Fig view transition symbol. */
export const FigViewTransitionSymbol = Symbol.for("fig.view-transition");

/** The assets. */
export const Assets: FigAssets = Object.assign(
  (props: Props & { children?: FigNode }) => props.children,
  { $$typeof: FigAssetsSymbol },
);

/** The error boundary. */
export const ErrorBoundary: FigErrorBoundary = Object.assign(
  (props: ErrorBoundaryProps) => props.children,
  { $$typeof: FigErrorBoundarySymbol },
);

/** The suspense. */
export const Suspense: FigSuspense = Object.assign(
  (props: SuspenseProps) => props.children,
  { $$typeof: FigSuspenseSymbol },
);

/** The activity. */
export const Activity: FigActivity = Object.assign(
  (props: ActivityProps) => props.children,
  { $$typeof: FigActivitySymbol },
);

/** The view transition. */
export const ViewTransition: FigViewTransition = Object.assign(
  (props: ViewTransitionProps) => props.children,
  { $$typeof: FigViewTransitionSymbol },
);

/** Creates element. */
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

  return {
    $$typeof: FigElementSymbol,
    type,
    key,
    props:
      "mix" in props && typeof type === "string"
        ? resolveHostMix(type, props)
        : props,
  };
}

/** Checks whether valid element. */
export function isValidElement(value: unknown): value is FigElement {
  return hasObjectBrand(value, FigElementSymbol);
}

/** Creates portal node. */
export function createPortalNode<Target>(
  children: FigNode,
  target: Target,
  key: Key | null = null,
): FigPortal<Target> {
  return { $$typeof: FigPortalSymbol, children, key, target };
}

/** Checks whether portal. */
export function isPortal(value: unknown): value is FigPortal {
  return hasObjectBrand(value, FigPortalSymbol);
}

/** Client reference. */
export function clientReference<P extends Props = Props>(
  options: ClientReferenceOptions<P>,
): FigClientReference<P> {
  return Object.assign(
    (): never => {
      throw new Error(
        `Client reference "${options.id}" cannot be rendered on the server directly.`,
      );
    },
    {
      $$typeof: FigClientReferenceSymbol,
      assets: options.assets,
      id: options.id,
      ssr: options.ssr,
    },
  );
}

/** Lazy. */
export function lazy<T extends ComponentType<any>>(
  load: LazyLoader<T>,
): ComponentType<ComponentProps<T>> {
  let promise: PromiseLike<T> | null = null;
  let rejected = false;

  const Lazy: ComponentType<ComponentProps<T>> = (props) => {
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

  return Lazy;
}

/** Checks whether client reference. */
export function isClientReference(value: unknown): value is FigClientReference {
  return hasFunctionBrand(value, FigClientReferenceSymbol);
}

/** Checks whether suspense. */
export function isSuspense(value: unknown): value is FigSuspense {
  return hasFunctionBrand(value, FigSuspenseSymbol);
}

/** Checks whether activity. */
export function isActivity(value: unknown): value is FigActivity {
  return hasFunctionBrand(value, FigActivitySymbol);
}

/** Checks whether error boundary. */
export function isErrorBoundary(value: unknown): value is FigErrorBoundary {
  return hasFunctionBrand(value, FigErrorBoundarySymbol);
}

/** Checks whether view transition. */
export function isViewTransition(value: unknown): value is FigViewTransition {
  return hasFunctionBrand(value, FigViewTransitionSymbol);
}

/** Checks whether assets. */
export function isAssets(value: unknown): value is FigAssets {
  return hasFunctionBrand(value, FigAssetsSymbol);
}

function hasObjectBrand(value: unknown, brand: symbol): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value &&
    value.$$typeof === brand
  );
}

function hasFunctionBrand(value: unknown, brand: symbol): boolean {
  return (
    typeof value === "function" &&
    "$$typeof" in value &&
    value.$$typeof === brand
  );
}
