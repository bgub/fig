import type { Props } from "./element.ts";

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

export const FigMixinSymbol = Symbol.for("fig.mixin");
const FigMixinSlotSymbol = Symbol("fig.mixin-slot");

/** Creates a render-time host behavior for the `mix` prop. */
export function createMixin<TArgs extends unknown[]>(
  type: MixinType<TArgs>,
): MixinFactory<TArgs> {
  return (...args) => ({
    $$typeof: FigMixinSymbol,
    args,
    type: type as MixinRuntimeType,
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
