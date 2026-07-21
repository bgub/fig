import type { FigNode } from "./element.ts";

export interface FigContext<T> {
  (props: { value: T; children?: FigNode }): FigNode;
  readonly $$typeof: symbol;
  readonly defaultValue: T;
}

export const FigContextSymbol = Symbol.for("fig.context");

export function createContext<T>(defaultValue: T): FigContext<T> {
  return Object.assign(
    (props: { value: T; children?: FigNode }) => props.children,
    {
      $$typeof: FigContextSymbol,
      defaultValue,
    },
  );
}

export function isContext(value: unknown): value is FigContext<unknown> {
  return (
    typeof value === "function" &&
    "$$typeof" in value &&
    value.$$typeof === FigContextSymbol
  );
}
