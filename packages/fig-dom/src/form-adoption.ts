import { createMixin, type MixinDescriptor } from "@bgub/fig";
import { markClientOnlyHostBehavior, mixinSlot } from "@bgub/fig/internal";

/** Native controls whose pre-hydration state can be adopted. */
export type FormControl =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

/** Synchronously adopts a hydrated control's live state. */
export type FormStateAdopter<T extends FormControl = FormControl> = (
  node: T,
  signal: AbortSignal,
) => undefined;

interface AdoptionDescriptor {
  slot: string;
  callback: FormStateAdopter;
}

interface AdoptionSlot extends AdoptionDescriptor {
  controller: AbortController | null;
}

const AdoptionDescriptorsSymbol = Symbol.for("fig.form-adoption-descriptors");
interface AdoptionProps {
  [AdoptionDescriptorsSymbol]?: AdoptionDescriptor[];
}
const slots = new WeakMap<Element, AdoptionSlot[]>();

const adoptionMixin = createMixin((context, callback: FormStateAdopter) => {
  if (!["input", "textarea", "select"].includes(context.type))
    throw new Error("adoptFormState() requires an input, textarea, or select.");
  markClientOnlyHostBehavior(context, "adoptFormState()");
  const props = context.props as AdoptionProps;
  let descriptors = props[AdoptionDescriptorsSymbol];
  if (descriptors === undefined) {
    descriptors = [];
    Object.defineProperty(props, AdoptionDescriptorsSymbol, {
      configurable: true,
      value: descriptors,
    });
  }
  descriptors.push({ callback, slot: mixinSlot(context) });
});

/**
 * Adopts an edited server-rendered field once after hydration. This is a
 * hydration callback, not a native event. Update controlled state synchronously;
 * the signal aborts when the callback is replaced or the mixin/node is removed.
 */
export function adoptFormState<T extends FormControl = FormControl>(
  callback: FormStateAdopter<T>,
): MixinDescriptor {
  return adoptionMixin(callback as FormStateAdopter);
}

export function hasFormAdoption(props: object): boolean {
  return ((props as AdoptionProps)[AdoptionDescriptorsSymbol]?.length ?? 0) > 0;
}

export function updateFormAdoption(element: Element, props: object): void {
  const current = slots.get(element);
  const descriptors = (props as AdoptionProps)[AdoptionDescriptorsSymbol];
  if (current === undefined && descriptors === undefined) return;
  const previous = new Map((current ?? []).map((slot) => [slot.slot, slot]));
  const next: AdoptionSlot[] = [];
  for (const descriptor of descriptors ?? []) {
    let slot = previous.get(descriptor.slot);
    previous.delete(descriptor.slot);
    if (slot === undefined) slot = { ...descriptor, controller: null };
    else if (slot.callback !== descriptor.callback) {
      slot.controller?.abort();
      slot.controller = null;
      slot.callback = descriptor.callback;
    }
    next.push(slot);
  }
  for (const slot of previous.values()) slot.controller?.abort();
  if (next.length === 0) slots.delete(element);
  else slots.set(element, next);
}

export function detachFormAdoption(element: Element): void {
  for (const slot of slots.get(element) ?? []) slot.controller?.abort();
  slots.delete(element);
}

export function invokeFormAdoption(
  element: Element,
  reportError: (error: unknown) => void,
): void {
  const pending = (slots.get(element) ?? []).map((slot) => ({
    slot,
    callback: slot.callback,
  }));
  for (const { slot, callback } of pending) {
    slot.controller = new AbortController();
    try {
      callback(element as FormControl, slot.controller.signal);
    } catch (error) {
      reportError(error);
    } finally {
      if (!slots.get(element)?.includes(slot)) slot.controller?.abort();
    }
  }
}
