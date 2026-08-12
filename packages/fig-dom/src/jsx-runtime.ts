/**
 * JSX runtime types and functions for Fig DOM.
 *
 * @module
 */
import type { FigNode, Key } from "@bgub/fig";
import { Fragment, jsx, jsxDEV, jsxs } from "@bgub/fig/jsx-runtime";
import type { HostIntrinsicElements } from "./jsx.ts";

export { Fragment, jsx, jsxDEV, jsxs };

/** Type definitions for JSX. */
export namespace JSX {
  export type Element = FigNode;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicAttributes {
    key?: Key | null;
  }

  export interface IntrinsicElements extends HostIntrinsicElements {}
}
