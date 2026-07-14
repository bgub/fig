import { clientReference } from "@bgub/fig";

export const resourceRootId = "fig-resource-root";
export const likeButtonReferenceId =
  "apps/demo-payload/src/client-components.tsx#LikeButton";
export const postSlotReferenceId =
  "apps/demo-payload/src/resource-client.tsx#PostSlot";
export const weatherSlotReferenceId =
  "apps/demo-payload/src/resource-client.tsx#WeatherSlot";

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

// The dashboard's slots: client components serialized by reference, so the
// surrounding server component streams a frame while each slot keeps reading
// its own data resource on the client.
export const PostSlotRef = clientReference({
  id: postSlotReferenceId,
  load: () => Promise.resolve({}),
});

export const WeatherSlotRef = clientReference({
  id: weatherSlotReferenceId,
  load: () => Promise.resolve({}),
});
