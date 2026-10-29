/** The controls every widget hands a change handler. */
export interface ChangeDetails {
  /** The activation event, or `null` for an automatic change. */
  readonly event: Event | null;
  readonly isCanceled: boolean;
  readonly trigger: Element | undefined;
  cancel(): void;
}

export function createChangeDetails(event: Event | null, trigger?: Element) {
  // Deliberately unannotated so the mutators can write the flags the public
  // interface exposes as readonly.
  const details = {
    cancel() {
      this.isCanceled = true;
    },
    event,
    isCanceled: false,
    trigger,
  };
  return details;
}
