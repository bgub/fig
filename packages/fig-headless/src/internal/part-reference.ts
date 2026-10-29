import type { MixinContext } from "@bgub/fig";
import { setIdReference } from "./parts.ts";

type ReferenceAttribute = "aria-labelledby" | "aria-describedby" | "for";

/**
 * A relationship owns only its generated default. Resolve the final mixin
 * props at commit so a later author override wins; a later aria-label also
 * retires our generated aria-labelledby instead of leaving it to take priority.
 */
export function createPartReference(
  context: MixinContext,
  attribute: ReferenceAttribute,
  generated?: string,
) {
  const blocked = () =>
    attribute === "aria-labelledby" &&
    context.props["aria-label"] !== undefined;
  const automatic = context.props[attribute] == null && !blocked();
  const value = context.props[attribute] ?? (automatic ? generated : undefined);
  return {
    props: { [attribute]: value },
    sync(node: HTMLElement, target: string | undefined): boolean {
      if (!automatic || !context.owns(attribute)) return false;
      if (blocked()) {
        setIdReference(node, attribute, undefined);
        return false;
      }
      setIdReference(node, attribute, target);
      return true;
    },
  };
}

export type PartReference = ReturnType<typeof createPartReference>;
