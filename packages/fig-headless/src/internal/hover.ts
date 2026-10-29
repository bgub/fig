/** One pending hover intent. Replacing it releases its timer and abort listener. */
export function createHoverIntent() {
  let cancel: (() => void) | undefined;
  let opening = false;
  return {
    cancel: () => cancel?.(),
    cancelOpening: () => {
      if (opening) cancel?.();
    },
    schedule(
      open: boolean,
      change: () => void,
      delay: number,
      signal: AbortSignal,
    ): void {
      cancel?.();
      if (signal.aborted) return;
      opening = open;
      const timer = setTimeout(() => {
        clear();
        change();
      }, delay);
      function clear(): void {
        clearTimeout(timer);
        signal.removeEventListener("abort", clear);
        opening = false;
        cancel = undefined;
      }
      cancel = clear;
      signal.addEventListener("abort", clear, { once: true });
    },
  };
}
