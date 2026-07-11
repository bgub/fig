// fig-start's DevTools integration constants and open-state persistence. The
// SSR mechanism itself lives in @bgub/fig-devtools/{server,client}; this file
// only holds the framework-owned ids, layout, and the cookie that survives
// reloads.
export const DEVTOOLS_PANE_ID = "fig-start-devtools";
export const DEVTOOLS_LAYOUT_CLASS = "fig-start-devtools-layout";
export const DEVTOOLS_APP_PANE_CLASS = "fig-start-devtools-app";
export const DEVTOOLS_PANE_CLASS = "fig-start-devtools-pane";
const DEVTOOLS_OPEN_COOKIE = "fig-start-devtools-open";

// Docks the panel as a right-hand sidebar beside the app (a two-column grid),
// collapsing to a zero-width pane when the panel is closed so the app reclaims
// the space. Mirrors the placement="sidebar" layout the demos ship.
export const devtoolsLayoutStyle = `
.${DEVTOOLS_LAYOUT_CLASS} {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 100vh;
}
.${DEVTOOLS_APP_PANE_CLASS} {
  min-width: 0;
}
.${DEVTOOLS_PANE_CLASS} {
  position: sticky;
  top: 0;
  width: min(420px, 34vw);
  min-width: 360px;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid #252936;
  background: #171923;
}
.${DEVTOOLS_PANE_CLASS}:has(.fig-devtools.is-closed) {
  width: 0;
  min-width: 0;
  overflow: visible;
  border-left: 0;
}
@media (max-width: 780px) {
  .${DEVTOOLS_LAYOUT_CLASS} {
    grid-template-columns: 1fr;
  }
  .${DEVTOOLS_PANE_CLASS},
  .${DEVTOOLS_PANE_CLASS}:has(.fig-devtools.is-closed) {
    position: static;
    width: 0;
    min-width: 0;
    height: 0;
    overflow: visible;
    border-left: 0;
  }
  .${DEVTOOLS_PANE_CLASS}:not(:has(.fig-devtools.is-closed)) {
    width: auto;
    height: min(620px, 70vh);
    overflow: hidden;
    border-top: 1px solid #252936;
  }
}
`;

// Server: read the panel's open state from the request cookie so the
// prerendered panel matches what the client will hydrate.
export function devtoolsOpenFromRequest(request: Request): boolean {
  return readDevtoolsOpen(request.headers.get("cookie") ?? "");
}

// Client: mirror of the server read, from document.cookie.
export function readDevtoolsOpenCookie(): boolean {
  return readDevtoolsOpen(
    typeof document === "undefined" ? "" : document.cookie,
  );
}

export function storeDevtoolsOpen(open: boolean): void {
  document.cookie = `${DEVTOOLS_OPEN_COOKIE}=${String(open)};path=/;max-age=31536000;samesite=lax`;
}

function readDevtoolsOpen(cookies: string): boolean {
  return !cookies
    .split(";")
    .some((entry) => entry.trim() === `${DEVTOOLS_OPEN_COOKIE}=false`);
}
