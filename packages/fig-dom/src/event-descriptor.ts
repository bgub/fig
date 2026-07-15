import { isEmptyPropValue } from "./tree.ts";

export type EventOptions = Pick<AddEventListenerOptions, "capture" | "passive">;

export type EventCallback<E extends Event = Event> = (
  event: E,
  signal: AbortSignal,
) => void;

export interface EventDescriptor<E extends Event = Event> {
  readonly $$typeof: symbol;
  readonly type: string;
  readonly callback: EventCallback<E>;
  readonly options?: EventOptions;
}

const EventDescriptorSymbol = Symbol.for("fig.event");

/**
 * Declares one native listener for an element's `events` prop. Bubbling
 * events follow the logical Fig tree through portals; non-bubbling events,
 * including `focus` and `blur`, attach directly with native semantics.
 */
export function on<K extends keyof HTMLElementEventMap>(
  type: K,
  callback: EventCallback<HTMLElementEventMap[K]>,
  options?: EventOptions,
): EventDescriptor<HTMLElementEventMap[K]>;
export function on<E extends Event = Event>(
  type: string,
  callback: EventCallback<E>,
  options?: EventOptions,
): EventDescriptor<E>;
export function on(
  type: string,
  callback: EventCallback,
  options?: EventOptions,
): EventDescriptor {
  return { $$typeof: EventDescriptorSymbol, type, callback, options };
}

export function readEventDescriptors(
  value: unknown,
  elementType: string,
): Array<EventDescriptor | undefined> {
  if (isEmptyPropValue(value)) return [];
  if (!Array.isArray(value)) throwInvalidEventsProp(elementType);

  return value.map((item) => {
    if (isEmptyPropValue(item)) return undefined;
    if (!isEventDescriptor(item)) throwInvalidEventsProp(elementType);
    return item;
  });
}

function isEventDescriptor(value: unknown): value is EventDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EventDescriptor).$$typeof === EventDescriptorSymbol
  );
}

function throwInvalidEventsProp(elementType: string): never {
  const target = elementType === "" ? "an element" : `<${elementType}>`;
  throw new Error(
    `The events prop on ${target} must be an array of event descriptors created with on(type, callback).`,
  );
}
