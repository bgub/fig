import { clientReference } from "@bgub/fig";

export const resourceRootId = "fig-resource-root";
export const likeButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#LikeButton";

// Seeds the /resource-payload endpoint treats as failures, so the demo can
// exercise pre-root failure and recovery deterministically.
export const brokenResourceSeed = 500;

export interface LikeButtonProps {
  label: string;
}

export const LikeButtonRef = clientReference<LikeButtonProps>({
  id: likeButtonReferenceId,
  load: () => Promise.resolve({}),
});
