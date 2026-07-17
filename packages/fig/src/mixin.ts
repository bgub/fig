import type { Props } from "./element.ts";
import { type RenderDispatcher, setCurrentDispatcher } from "./hooks.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export interface MixinContext {
  /** The intrinsic host name receiving this mixin. */
  readonly type: string;
  /** Props composed by the host and every preceding mixin. */
  readonly props: Readonly<Props>;
}

export type EmptyMixinValue = false | 0 | 0n | "" | null | undefined;

export type MixinInput =
  | MixinDescriptor
  | EmptyMixinValue
  | ReadonlyArray<MixinInput>;

export type MixinResult = Props | MixinInput;

export type MixinType<TArgs extends unknown[] = unknown[]> = (
  context: MixinContext,
  ...args: TArgs
) => MixinResult;

type MixinRuntimeType = (
  context: MixinContext,
  ...args: unknown[]
) => MixinResult;

export interface MixinDescriptor {
  readonly $$typeof: symbol;
  readonly args: readonly unknown[];
  readonly type: MixinRuntimeType;
}

export type MixinFactory<TArgs extends unknown[]> = (
  ...args: TArgs
) => MixinDescriptor;

// Registered symbols: descriptors and contexts must stay recognizable when
// duplicate copies of this module are live (linked source next to a
// prebundled copy).
export const FigMixinSymbol = Symbol.for("fig.mixin");
const FigMixinSlotSymbol = Symbol.for("fig.mixin-slot");
const FigClientOnlyHostBehaviorSymbol = Symbol.for(
  "fig.client-only-host-behavior",
);

/** Creates a render-time host behavior for the `mix` prop. */
export function createMixin<TArgs extends unknown[]>(
  type: MixinType<TArgs>,
): MixinFactory<TArgs> {
  const runtimeType = type as MixinRuntimeType;
  const descriptorType = __DEV__ ? guardMixinType(runtimeType) : runtimeType;
  return (...args) => ({
    $$typeof: FigMixinSymbol,
    args,
    type: descriptorType,
  });
}

const maximumResolvedMixins = 1024;

export function resolveHostMix<P extends Props>(type: string, input: P): P {
  const props: Props = input;
  const mix = props.mix;
  delete props.mix;
  let resolvedMixins = 0;

  function resolve(value: unknown, slot: string): void {
    if (emptyMixinValue(value)) return;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        resolve(value[index], `${slot}.${index}`);
      }
      return;
    }
    if (!isMixinDescriptor(value)) {
      throw new Error(
        `The mix prop on <${type}> must contain descriptors created by createMixin().`,
      );
    }

    resolvedMixins += 1;
    if (resolvedMixins > maximumResolvedMixins) {
      throw new Error(
        `The mix prop on <${type}> resolved more than ${maximumResolvedMixins} mixins.`,
      );
    }

    const context: MixinRuntimeContext = {
      [FigMixinSlotSymbol]: slot,
      props,
      type,
    };
    const result = value.type(context, ...value.args);
    if (emptyMixinValue(result)) return;

    if (isMixinDescriptor(result) || Array.isArray(result)) {
      resolve(result, `${slot}.result`);
      return;
    }
    if (typeof result !== "object") throwInvalidMixinResult(type);
    const returnedProps = result as Props;

    if (
      "children" in returnedProps ||
      "key" in returnedProps ||
      "unsafeHTML" in returnedProps
    ) {
      throw new Error(
        `A mixin on <${type}> cannot return children, key, or unsafeHTML.`,
      );
    }

    const { mix: nestedMix, ...patch } = returnedProps;
    Object.assign(props, patch);
    resolve(nestedMix, `${slot}.mix`);
  }

  resolve(mix, "0");
  props.mix = mix;
  return props as P;
}

interface MixinRuntimeContext extends MixinContext {
  readonly [FigMixinSlotSymbol]: string;
}

export function mixinSlot(context: MixinContext): string {
  return (context as MixinRuntimeContext)[FigMixinSlotSymbol];
}

export function markClientOnlyHostBehavior(
  context: MixinContext,
  behavior: string,
): void {
  if (
    Reflect.get(context.props, FigClientOnlyHostBehaviorSymbol) !== undefined
  ) {
    return;
  }
  Object.defineProperty(context.props, FigClientOnlyHostBehaviorSymbol, {
    configurable: true,
    value: behavior,
  });
}

export function clientOnlyHostBehavior(props: object): string | undefined {
  const behavior = Reflect.get(props, FigClientOnlyHostBehaviorSymbol);
  return typeof behavior === "string" ? behavior : undefined;
}

function emptyMixinValue(value: unknown): value is EmptyMixinValue {
  return (
    value === false ||
    value === 0 ||
    value === 0n ||
    value === "" ||
    value === null ||
    value === undefined
  );
}

function isMixinDescriptor(value: unknown): value is MixinDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as MixinDescriptor).$$typeof === FigMixinSymbol
  );
}

function throwInvalidMixinResult(type: string): never {
  throw new Error(
    `A mixin on <${type}> must return host props, more mixins, or nothing.`,
  );
}

// Dev-only: the wrapper lives in the createMixin module copy, so it guards the
// dispatcher used by hooks imported alongside that factory even when another
// linked or prebundled copy resolves the descriptor.
function guardMixinType(type: MixinRuntimeType): MixinRuntimeType {
  return (context, ...args) => {
    const previousDispatcher = setCurrentDispatcher(
      mixinDispatcher(context.type, mixinSlot(context)),
    );
    try {
      return type(context, ...args);
    } finally {
      setCurrentDispatcher(previousDispatcher);
    }
  };
}

function mixinDispatcher(type: string, slot: string): RenderDispatcher {
  return new Proxy({} as RenderDispatcher, {
    get(_target, property) {
      throw new Error(
        `A mixin on <${type}> (slot ${slot}) called ${String(property)}. ` +
          "Mixins are pure render-time code: hooks and read verbs belong to " +
          "the component; host lifetimes belong in returned on() or bind " +
          "behavior.",
      );
    },
  });
}
