import {
  createMixin,
  type MixinContext,
  type MixinDescriptor,
} from "@bgub/fig";
import { mixinSlot } from "@bgub/fig/internal";

export type EventOptions = Pick<AddEventListenerOptions, "capture" | "passive">;

export type EventCallback<E extends Event = Event> = (
  event: E,
  signal: AbortSignal,
) => void;

export interface NativeEventDescriptor<E extends Event = Event> {
  readonly slot: string;
  readonly type: string;
  readonly callback: EventCallback<E>;
  readonly options?: EventOptions;
}

const NativeEventDescriptorsSymbol = Symbol.for("fig.native-event-descriptors");

const eventMixin = createMixin(
  (
    context: MixinContext,
    type: string,
    callback: EventCallback,
    options?: EventOptions,
  ) => {
    const props = context.props as EventDescriptorProps;
    (props[NativeEventDescriptorsSymbol] ??= []).push({
      callback,
      options,
      slot: mixinSlot(context),
      type,
    });
  },
);

interface EventDescriptorProps {
  [NativeEventDescriptorsSymbol]?: NativeEventDescriptor[];
}

/**
 * Declares one native listener for an element's `mix` prop. Bubbling
 * events follow the logical Fig tree through portals; non-bubbling events,
 * including `focus` and `blur`, attach directly with native semantics.
 */
export function on<K extends keyof HTMLElementEventMap>(
  type: K,
  callback: EventCallback<HTMLElementEventMap[K]>,
  options?: EventOptions,
): MixinDescriptor;
export function on<E extends Event = Event>(
  type: string,
  callback: EventCallback<E>,
  options?: EventOptions,
): MixinDescriptor;
export function on(
  type: string,
  callback: EventCallback,
  options?: EventOptions,
): MixinDescriptor {
  return eventMixin(type, callback, options);
}

const emptyEventDescriptors: readonly never[] = [];

export function eventDescriptorsFromProps(
  props: object,
): readonly NativeEventDescriptor[] {
  return (
    (props as EventDescriptorProps)[NativeEventDescriptorsSymbol] ??
    emptyEventDescriptors
  );
}
