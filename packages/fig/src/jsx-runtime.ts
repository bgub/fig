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
  if (props !== null && "key" in props) {
    const { key: propsKey, ...rest } = props;
    return {
      $$typeof: FigElementSymbol,
      type,
      key: key ?? (propsKey as Key | null | undefined) ?? null,
      props: rest,
    };
  }

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

// Core's JSX namespace is renderer-neutral. Host-prop vocabulary belongs to
// renderer runtimes such as @bgub/fig-dom/jsx-runtime, so using core directly
// as jsxImportSource rejects intrinsic tags.
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
