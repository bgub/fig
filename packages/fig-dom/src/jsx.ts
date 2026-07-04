import type { FigNode, Key } from "@bgub/fig";
// Augmenting a module requires importing it, even just for types.
import type {} from "@bgub/fig/jsx-runtime";
import type { Bind } from "./bind.ts";
import type { EventDescriptor } from "./events.ts";

// Stage-1 JSX host-prop types: Fig's own props are enforced precisely and
// per-tag element identity flows into `bind`; everything else is an open
// native attribute (class, for, tabindex, aria-*, data-*, stroke-width, ...)
// — attributes are an open, stringly vocabulary by nature. A future stage
// can swap the open index for externally-maintained per-attribute typings
// without changing this shape.

// Mirrors the runtime's isEmptyPropValue: null, undefined, and false all
// mean "not provided", for every host prop kind — so `cond && value` works
// uniformly in prop and style positions.
export type EmptyPropValue = false | null | undefined;

// Style objects are written to the CSSOM as-is: camelCase or --custom
// property names, string values. Numeric values are deliberately rejected —
// Fig has no px-auto-suffix table, so a number would be silently dropped at
// runtime.
export type HostStyle = Readonly<Record<string, string | EmptyPropValue>>;

// `any` for variance only: on("click", ...) yields EventDescriptor<MouseEvent>
// and callback parameters are contravariant, so a concrete-event descriptor
// is not assignable to EventDescriptor<Event>.
// oxlint-disable-next-line typescript/no-explicit-any
export type HostEvents = ReadonlyArray<EventDescriptor<any> | EmptyPropValue>;

export interface HostProps<E extends Element> {
  // Fig's host contract.
  bind?: Bind<E> | EmptyPropValue;
  children?: FigNode;
  events?: HostEvents | EmptyPropValue;
  key?: Key | null;
  style?: HostStyle | EmptyPropValue;
  unsafeHTML?: string | EmptyPropValue;

  // React-habit traps: the native names and the events/bind APIs are the way.
  className?: never;
  dangerouslySetInnerHTML?: never;
  htmlFor?: never;
  ref?: never;

  // Listener props do not exist — declare listeners with events={[on(...)]}.
  // (This also rejects native inline-handler attributes like onclick.)
  [handler: `on${string}`]: never;

  // Native attributes: scalars serialized by the renderer; empty values
  // remove the attribute. (The union exists so the named props above satisfy
  // the index signature; arbitrary attributes are effectively scalar-valued.)
  [attribute: string]: FigNode | HostStyle | HostEvents | Bind<E>;
}

// The `& Element` is an identity for real tag maps (their values are already
// elements); it only exists because interfaces have no implicit index
// signature, so they cannot satisfy a Record<string, Element> constraint.
type HostPropsByTag<TagNameMap> = {
  [Tag in keyof TagNameMap]: HostProps<TagNameMap[Tag] & Element>;
};

// Overlapping tag names (a, script, style, title) take the HTML typing.
export type HostIntrinsicElements = HostPropsByTag<HTMLElementTagNameMap> &
  HostPropsByTag<Omit<SVGElementTagNameMap, keyof HTMLElementTagNameMap>> &
  HostPropsByTag<
    Omit<
      MathMLElementTagNameMap,
      keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap
    >
  > & {
    // Custom elements are valid DOM elements even though TypeScript's built-in
    // tag maps cannot know their concrete class. Require the platform's dashed
    // name shape and infer the baseline HTMLElement contract.
    [customElement: `${string}-${string}`]: HostProps<HTMLElement>;
  };

// Renderer packages own host-prop vocabulary: this augmentation fills core's
// deliberately empty JSX.IntrinsicElements. It is global once any fig-dom
// import is in the program.
declare module "@bgub/fig/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements extends HostIntrinsicElements {}
  }
}
