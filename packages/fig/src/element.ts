export type Key = string | number;
export type Props = Record<string, unknown>;
export type ElementType<P = Props> =
  | string
  | typeof Fragment
  | ((props: P & { children?: FigNode }) => FigNode);
export type FigText = string | number;
export type FigChild = FigElement | FigText | boolean | null | undefined;
export type FigNode = FigChild | FigChild[];

export interface FigElement<P = Props> {
  readonly $$typeof: symbol;
  readonly type: ElementType<P>;
  readonly key: Key | null;
  readonly props: P & { children?: FigNode };
}

export const Fragment = Symbol.for("fig.fragment");
export const FigElementSymbol = Symbol.for("fig.element");

export function createElement<P extends Props>(
  type: ElementType<P>,
  config: (P & { key?: Key | null }) | null,
  ...children: FigChild[]
): FigElement<P> {
  const props = { ...(config ?? {}) } as P & {
    children?: FigNode;
    key?: Key | null;
  };
  const key = props.key ?? null;
  delete props.key;

  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;

  return { $$typeof: FigElementSymbol, type, key, props };
}

export function isValidElement(value: unknown): value is FigElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as FigElement).$$typeof === FigElementSymbol
  );
}
