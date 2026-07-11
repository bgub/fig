// Client half of the demos' shared DevTools wiring (the server half is
// demo-devtools-prerender.ts). One cookie drives the panel state in every
// demo so the server can render the true open/closed state directly.
// createElement instead of JSX: this file sits above the per-app tsconfigs
// that configure the fig JSX runtime.
import { createElement } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { FigDevtools, type FigDevtoolsHook } from "@bgub/fig-devtools";

export const devtoolsOpenCookie = "fig-demo-devtools-open";

export function readDevtoolsOpen(cookies: string): boolean {
  return !cookies
    .split(";")
    .some((entry) => entry.trim() === `${devtoolsOpenCookie}=false`);
}

export function storeDevtoolsOpen(open: boolean): void {
  document.cookie = `${devtoolsOpenCookie}=${String(open)};path=/;max-age=31536000;samesite=lax`;
}

// The shell streams the panel prerendered from the server's tree — structure
// only, since hooks and fiber ids are client-runtime facts. Swap in the live
// panel once the first real commit gives the hook actual data; the
// replacement paints near-identical pixels.
export function mountLiveDevtoolsPanel(
  container: HTMLElement,
  hook: FigDevtoolsHook,
): void {
  const unsubscribe = hook.subscribe(() => {
    if (hook.commits.length === 0) return;
    unsubscribe();
    container.textContent = "";
    createRoot(container, { devtools: false }).render(
      createElement(FigDevtools, {
        defaultOpen: readDevtoolsOpen(document.cookie),
        hook,
        onOpenChange: storeDevtoolsOpen,
        placement: "sidebar",
      }),
    );
  });
}
