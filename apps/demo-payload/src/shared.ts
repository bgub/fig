import { clientReference } from "@bgub/fig";

export const appRootId = "fig-payload-root";
export const devtoolsPaneId = "fig-payload-devtools";
// Shared across the fig demos so the panel state follows the user.
export const devtoolsOpenKey = "fig-demo-devtools-open";
// Runs before first paint: collapses the server-reserved DevTools pane when
// the panel was last closed, so neither state causes layout shift.
export const devtoolsStateScript = `try{if(localStorage.getItem("${devtoolsOpenKey}")==="false")document.documentElement.setAttribute("data-fig-devtools-closed","")}catch(e){}`;
export const feedBoundaryId = "demo-payload-feed";
export const noteBoundaryId = "demo-payload-note";
export const appRefreshButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#AppRefreshButton";
export const refreshButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#RefreshButton";

export interface AppRefreshButtonProps {
  seed: number;
}

export interface RefreshButtonProps {
  boundary: string;
  label: string;
  seed: number;
}

export const AppRefreshButtonRef = clientReference<AppRefreshButtonProps>({
  id: appRefreshButtonReferenceId,
  load: () => Promise.resolve({}),
});

export const RefreshButtonRef = clientReference<RefreshButtonProps>({
  id: refreshButtonReferenceId,
  load: () => Promise.resolve({}),
});
