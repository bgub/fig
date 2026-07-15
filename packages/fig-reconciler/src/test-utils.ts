declare const setImmediate: ((callback: () => void) => unknown) | undefined;

// Count host turns instead of sleeping for wall-clock time. Five turns cover
// a yielded render, its continuation, and follow-up commit/effect work.
export async function waitForHostTurns(turns = 5): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => {
      if (typeof setImmediate === "function") {
        void setImmediate(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}
