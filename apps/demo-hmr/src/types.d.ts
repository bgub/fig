import type { FigNode } from "@bgub/fig";

declare global {
  namespace JSX {
    type Element = FigNode;

    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}
