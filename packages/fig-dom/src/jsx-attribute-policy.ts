import type { FigNode, Key } from "@bgub/fig";
import type {
  HtmlAttributeNameByTag,
  HtmlGlobalAttributeName,
  SvgAttributeNameByTag,
  SvgGlobalAttributeName,
} from "./jsx-attributes.generated.ts";
import type { Bind } from "./bind.ts";
import type { EventDescriptor } from "./events.ts";

// This file is the hand-written policy layer over the generated attribute
// snapshot. Keep external vocabulary churn in jsx-attributes.generated.ts and
// Fig-specific decisions here.

export type EmptyPropValue = false | null | undefined;

type AttributeValue = string | number | true | EmptyPropValue;

export type HostStyle = Readonly<Record<string, string | EmptyPropValue>>;

// `any` for variance only: on("click", ...) yields EventDescriptor<MouseEvent>
// and callback parameters are contravariant, so a concrete-event descriptor
// is not assignable to EventDescriptor<Event>.
// oxlint-disable-next-line typescript/no-explicit-any
export type HostEvents = ReadonlyArray<EventDescriptor<any> | EmptyPropValue>;

interface FigHostProps<E extends Element> {
  bind?: Bind<E> | EmptyPropValue;
  children?: FigNode;
  events?: HostEvents | EmptyPropValue;
  key?: Key | null;
  style?: HostStyle | EmptyPropValue;
  suppressHydrationWarning?: boolean | null;
  unsafeHTML?: string | EmptyPropValue;
}

interface ReactHabitTraps {
  className?: never;
  dangerouslySetInnerHTML?: never;
  htmlFor?: never;
  ref?: never;
  [handler: `on${string}`]: never;
}

type FigOwnedPropName = keyof FigHostProps<Element> | keyof ReactHabitTraps;

type FigGlobalAttributeName = `aria-${string}` | `data-${string}` | "role";

type SvgLegacyAttributeName = "xlink:href" | "xml:space" | "xmlns:xlink";

type HostAttributeProps<AttributeName extends string> = {
  [Name in Exclude<AttributeName, FigOwnedPropName>]?: AttributeValue;
};

type HtmlAttributes<Tag extends keyof HtmlAttributeNameByTag> =
  | HtmlAttributeNameByTag[Tag]
  | FigGlobalAttributeName;

type SvgAttributes<Tag extends keyof SvgAttributeNameByTag> =
  | SvgAttributeNameByTag[Tag]
  | FigGlobalAttributeName
  | SvgLegacyAttributeName;

export type HostProps<
  E extends Element,
  AttributeName extends string = never,
> = FigHostProps<E> & ReactHabitTraps & HostAttributeProps<AttributeName>;

export type HtmlHostProps<Tag extends string, E extends Element> = HostProps<
  E,
  Tag extends keyof HtmlAttributeNameByTag
    ? HtmlAttributes<Tag>
    : HtmlGlobalAttributeName | FigGlobalAttributeName
>;

export type SvgHostProps<Tag extends string, E extends Element> = HostProps<
  E,
  Tag extends keyof SvgAttributeNameByTag
    ? SvgAttributes<Tag>
    : SvgGlobalAttributeName | FigGlobalAttributeName | SvgLegacyAttributeName
>;

export type OpenHtmlHostProps<E extends Element> = HostProps<
  E,
  HtmlGlobalAttributeName | FigGlobalAttributeName
>;

export type OpenSvgHostProps<E extends Element> = HostProps<
  E,
  SvgGlobalAttributeName | FigGlobalAttributeName | SvgLegacyAttributeName
>;

export interface OpenHostProps<E extends Element>
  extends FigHostProps<E>, ReactHabitTraps {
  // Custom elements and MathML stay open: their vocabularies are app-defined
  // or not covered well enough by the external HTML/SVG attribute packages.
  [attribute: string]: FigNode | HostStyle | HostEvents | Bind<E>;
}
