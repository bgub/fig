import { clientReference } from "@bgub/fig";

export const appRootId = "fig-payload-root";
export const devtoolsPaneId = "fig-payload-devtools";
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
