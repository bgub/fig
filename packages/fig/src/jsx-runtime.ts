import {
  type ElementType,
  type FigElement,
  FigElementSymbol,
  Fragment,
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

export { jsx as jsxs, jsx as jsxDEV, Fragment };
