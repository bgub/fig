import type {
  HtmlHostProps,
  OpenHostProps,
  OpenHtmlHostProps,
  SvgHostProps,
} from "./jsx-attribute-policy.ts";

export type {
  EmptyPropValue,
  HostEvents,
  HostProps,
  HostStyle,
  HtmlHostProps,
  OpenHostProps,
  OpenHtmlHostProps,
  OpenSvgHostProps,
  SvgHostProps,
} from "./jsx-attribute-policy.ts";

// The `& Element` is an identity for real tag maps (their values are already
// elements); it only exists because interfaces have no implicit index
// signature, so they cannot satisfy a Record<string, Element> constraint.
type HtmlHostPropsByTag<TagNameMap> = {
  [Tag in keyof TagNameMap]: Tag extends string
    ? HtmlHostProps<Tag, TagNameMap[Tag] & Element>
    : OpenHtmlHostProps<TagNameMap[Tag] & Element>;
};

type SvgHostPropsByTag<TagNameMap> = {
  [Tag in keyof TagNameMap]: Tag extends string
    ? SvgHostProps<Tag, TagNameMap[Tag] & Element>
    : OpenHostProps<TagNameMap[Tag] & Element>;
};

type OpenHostPropsByTag<TagNameMap> = {
  [Tag in keyof TagNameMap]: OpenHostProps<TagNameMap[Tag] & Element>;
};

// Overlapping tag names (a, script, style, title) take the HTML typing.
export type HostIntrinsicElements = HtmlHostPropsByTag<HTMLElementTagNameMap> &
  SvgHostPropsByTag<Omit<SVGElementTagNameMap, keyof HTMLElementTagNameMap>> &
  OpenHostPropsByTag<
    Omit<
      MathMLElementTagNameMap,
      keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap
    >
  > & {
    // Custom elements are valid DOM elements even though TypeScript's built-in
    // tag maps cannot know their concrete class. Require the platform's dashed
    // name shape and infer the baseline HTMLElement contract.
    [customElement: `${string}-${string}`]: OpenHostProps<HTMLElement>;
  };
