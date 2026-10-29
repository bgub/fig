import { useId, useMemo } from "@bgub/fig";

/**
 * Generates stable ids for the parts of one widget instance. Values are
 * arbitrary, so each one takes the next index the first time it appears.
 */
export function usePartIds(): (value: unknown, part: string) => string {
  const id = useId();
  const indexes = useMemo(() => new Map<unknown, number>(), []);

  return (value, part) => {
    let index = indexes.get(value);
    if (index === undefined) {
      index = indexes.size;
      indexes.set(value, index);
    }
    return `${id}-${part}-${index}`;
  };
}
