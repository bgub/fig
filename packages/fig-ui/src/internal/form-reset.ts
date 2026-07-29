import { onAbort } from "./composite.ts";

/**
 * Listens once per owning form even when a widget binds several native inputs.
 * Reset state is applied in a microtask, after the cancelable native reset
 * event has either completed or been refused.
 */
export function createFormReset(onReset: () => void) {
  const forms = new Map<
    HTMLFormElement,
    { readonly controller: AbortController; count: number }
  >();

  function bind(node: HTMLElement, signal: AbortSignal): void {
    if (!(node instanceof HTMLInputElement) || node.form === null) return;
    const form = node.form;
    let registration = forms.get(form);
    if (registration === undefined) {
      const controller = new AbortController();
      registration = { controller, count: 0 };
      forms.set(form, registration);
      form.addEventListener(
        "reset",
        (event) => {
          queueMicrotask(() => {
            if (!controller.signal.aborted && !event.defaultPrevented)
              onReset();
          });
        },
        { signal: controller.signal },
      );
    }
    registration.count += 1;

    onAbort(signal, () => {
      const current = forms.get(form);
      if (current === undefined) return;
      current.count -= 1;
      if (current.count > 0) return;
      current.controller.abort();
      forms.delete(form);
    });
  }

  return { bind };
}
