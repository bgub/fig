export interface PartRegistration<Value> {
  readonly node: HTMLElement;
  readonly value: Value;
}

/** Registration data changes without ending the committed host lifetime. */
export function createPartCollection<Value>(changed: () => void = () => {}) {
  const entries = new Map<
    HTMLElement,
    { node: HTMLElement; value: Value; signal: AbortSignal }
  >();
  function bind(node: HTMLElement, signal: AbortSignal, value: Value): boolean {
    const previous = entries.get(node);
    if (previous?.signal === signal) {
      previous.value = value;
      // Host props such as id/form can change even when metadata is equal.
      changed();
      return false;
    }
    const entry = { node, signal, value };
    entries.set(node, entry);
    changed();
    signal.addEventListener(
      "abort",
      () => {
        if (entries.get(node) !== entry) return;
        entries.delete(node);
        changed();
      },
      { once: true },
    );
    return true;
  }
  return {
    bind,
    get: (node: HTMLElement): Value | undefined => entries.get(node)?.value,
    items: (): readonly PartRegistration<Value>[] => [...entries.values()],
  };
}

/** One role, with cleanup guarded by lifetime identity, not node identity. */
export function createPartSlot(changed: () => void) {
  let current: { node: HTMLElement; signal: AbortSignal } | null = null;
  function bind(node: HTMLElement, signal: AbortSignal): boolean {
    if (current?.node === node && current.signal === signal) {
      changed();
      return false;
    }
    const registration = { node, signal };
    current = registration;
    changed();
    signal.addEventListener(
      "abort",
      () => {
        if (current !== registration) return;
        current = null;
        changed();
      },
      { once: true },
    );
    return true;
  }
  return { bind, node: () => current?.node ?? null };
}
