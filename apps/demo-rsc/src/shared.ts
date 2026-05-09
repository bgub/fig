import { clientReference } from "@bgub/fig";

export const appRootId = "fig-rsc-root";
export const feedBoundaryId = "demo-rsc-feed";
export const refreshButtonReferenceId =
  "apps/demo-rsc/src/client-components.tsx#RefreshButton";

export interface RefreshButtonProps {
  boundary: string;
  seed: number;
}

export const RefreshButtonRef = clientReference<RefreshButtonProps>({
  id: refreshButtonReferenceId,
  load: () => Promise.resolve({}),
});
