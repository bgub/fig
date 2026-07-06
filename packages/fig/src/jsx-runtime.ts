import {
  type ElementType,
  type FigElement,
  FigElementSymbol,
  type FigNode,
  Fragment,
  type Key,
} from "./element.ts";

type JSXProps = Record<string, unknown>;

export function jsx(
  type: ElementType,
  props: JSXProps | null,
  key?: string | number,
): FigElement {
  return {
    $$typeof: FigElementSymbol,
    type,
    key: key ?? null,
    props: props ?? {},
  };
}

// The automatic-runtime contract is exactly jsx/jsxs/jsxDEV/Fragment. jsxDEV
// aliases jsx: the dev transform's extra arguments (isStaticChildren, source,
// self) are ignored — Fig builds component stacks from fibers instead.
export { Fragment, jsx as jsxs, jsx as jsxDEV };

// The JSX namespace TypeScript resolves under jsxImportSource: "@bgub/fig".
// IntrinsicElements is deliberately empty here: host-prop vocabulary belongs
// to renderers, so @bgub/fig-dom augments it with the DOM tag map (having
// any fig-dom import in the program is enough — augmentations are global).
// A compilation with no renderer types in scope rejects intrinsic tags.
export namespace JSX {
  // The type of a JSX expression, and what function components may return:
  // any renderable node (elements, strings, numbers, booleans, null, arrays).
  export type Element = FigNode;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  // Props every JSX element accepts beyond its own declared props.
  export interface IntrinsicAttributes {
    key?: Key | null;
  }

  export interface IntrinsicElements {}
}
