// Demo-specific DevTools open-state persistence. One cookie drives the panel
// across every demo so the server can render the true open/closed state
// directly; the SSR wiring itself now lives in @bgub/fig-devtools/{server,client}.
export const devtoolsOpenCookie = "fig-demo-devtools-open";

export function readDevtoolsOpen(cookies: string): boolean {
  return !cookies
    .split(";")
    .some((entry) => entry.trim() === `${devtoolsOpenCookie}=false`);
}

export function storeDevtoolsOpen(open: boolean): void {
  document.cookie = `${devtoolsOpenCookie}=${String(open)};path=/;max-age=31536000;samesite=lax`;
}

export function devtoolsOpenFromCookieHeader(
  header: string | string[] | undefined,
): boolean {
  return readDevtoolsOpen((Array.isArray(header) ? header[0] : header) ?? "");
}
