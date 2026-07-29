import type { MixinContext } from "@bgub/fig";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export function expectHost(
  context: MixinContext,
  part: string,
  expected: string,
): void {
  if (!__DEV__) return;
  if (context.type === expected) return;
  throw new Error(
    `Fig UI ${part} must be applied to <${expected}>, not <${context.type}>.`,
  );
}

export function expectPopupId(
  context: MixinContext,
  id: string,
  part = "popover",
): void {
  if (!__DEV__) return;
  if (id.trim() === "") {
    throw new Error(`Fig UI ${part} id must not be empty.`);
  }
  const authored = context.props.id;
  if (authored === undefined || authored === id) return;
  throw new Error(
    `Fig UI ${part} owns its id relationship. Pass id: "${String(authored)}" to the widget root instead of setting it on the host.`,
  );
}

export function assertAccessibleName(node: HTMLElement, part: string): void {
  if (!__DEV__) return;
  const direct = node.getAttribute("aria-label")?.trim();
  if (direct !== undefined && direct !== "") return;

  const references = node
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .filter(Boolean);
  if (
    references !== undefined &&
    references.some((id) => node.ownerDocument.getElementById(id) !== null)
  ) {
    return;
  }

  throw new Error(
    `Fig UI ${part} requires an accessible name from aria-label or aria-labelledby.`,
  );
}

export function assertControlLabel(control: HTMLElement): void {
  if (!__DEV__) return;
  const labels = (
    control as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> }
  ).labels;
  if (labels !== undefined && labels.length > 0) return;
  assertAccessibleName(control, "field control");
}

export function assertPanelOwner(owner: HTMLElement | undefined): void {
  if (!__DEV__ || owner !== undefined) return;
  throw new Error(
    "Fig UI panel has no matching control. Use the same value for both parts.",
  );
}

export function assertUniqueValues(
  items: readonly { readonly value: unknown }[],
  part: string,
): void {
  if (!__DEV__) return;
  const values = new Set<unknown>();
  for (const item of items) {
    if (values.has(item.value)) {
      throw new Error(`Fig UI ${part} values must be unique within one root.`);
    }
    values.add(item.value);
  }
}

export function assertSinglePart(
  items: readonly unknown[],
  part: string,
): void {
  if (!__DEV__ || items.length < 2) return;
  throw new Error(`Fig UI ${part} may be applied to only one mounted host.`);
}

export function assertUniqueIds(
  nodes: readonly HTMLElement[],
  part: string,
): void {
  if (!__DEV__) return;
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.id === "") {
      throw new Error(`Fig UI ${part} must use non-empty ids.`);
    }
    if (!ids.has(node.id)) {
      ids.add(node.id);
      continue;
    }
    throw new Error(`Fig UI ${part} must use unique ids.`);
  }
}

export function assertSingleSelection(
  values: readonly unknown[],
  part: string,
): void {
  if (!__DEV__ || values.length < 2) return;
  throw new Error(`Fig UI ${part} accepts at most one selected value.`);
}
