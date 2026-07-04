import { clientReference } from "@bgub/fig";

export const appRootId = "fig-payload-root";
export const feedBoundaryId = "demo-payload-feed";
export const refreshButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#RefreshButton";

export interface RefreshButtonProps {
  boundary: string;
  seed: number;
}

export const RefreshButtonRef = clientReference<RefreshButtonProps>({
  id: refreshButtonReferenceId,
  load: () => Promise.resolve({}),
});
