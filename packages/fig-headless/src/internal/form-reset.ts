/** Listens once per form, following committed host/form ownership. */
export function createFormReset(onReset: () => void) {
  const forms = new Map<
    HTMLFormElement,
    { controller: AbortController; count: number }
  >();
  const inputs = new Map<
    HTMLElement,
    { form: HTMLFormElement; signal: AbortSignal; release: () => void }
  >();

  function bind(node: HTMLElement, signal: AbortSignal): void {
    const previous = inputs.get(node);
    const nextForm = node instanceof HTMLInputElement ? node.form : null;
    if (previous?.signal === signal && previous.form === nextForm) return;
    previous?.release();
    if (nextForm === null) return;
    const form = nextForm;
    let registration = forms.get(form);
    if (registration === undefined) {
      const controller = new AbortController();
      registration = { controller, count: 0 };
      forms.set(form, registration);
      form.addEventListener(
        "reset",
        (event) => {
          // The platform resets native values after dispatch. Cancellation is
          // final only then; this delay is about the reset event, not rebinding.
          queueMicrotask(() => {
            if (forms.has(form) && !event.defaultPrevented) onReset();
          });
        },
        { signal: controller.signal },
      );
    }
    registration.count++;
    const entry = { form, signal, release };
    inputs.set(node, entry);
    function release(): void {
      if (inputs.get(node) !== entry) return;
      inputs.delete(node);
      signal.removeEventListener("abort", release);
      const current = forms.get(form);
      if (current === undefined || --current.count > 0) return;
      current.controller.abort();
      forms.delete(form);
    }
    signal.addEventListener("abort", release, { once: true });
  }
  return { bind };
}
