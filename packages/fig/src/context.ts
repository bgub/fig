import type { FigNode } from "./element.ts";

/** Describes Fig context. */
export interface FigContext<T> {
  (props: { value: T; children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
  readonly defaultValue: T;
}

/** The Fig context symbol. */
export const FigContextSymbol = Symbol.for("fig.context");

/** Creates context. */
export function createContext<T>(defaultValue: T): FigContext<T> {
  return Object.assign(
    (props: { value: T; children?: FigNode }) => props.children,
    {
      $$typeof: FigContextSymbol,
      defaultValue,
    },
  );
}

/** Checks whether context. */
export function isContext(value: unknown): value is FigContext<unknown> {
  return (
    typeof value === "function" &&
    "$$typeof" in value &&
    value.$$typeof === FigContextSymbol
  );
}
