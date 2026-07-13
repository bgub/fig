import { useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import type { LikeButtonProps } from "./resource-shared.ts";

// The demo\'s interactive island: decoded out of the serialized post via
// resolveClientReference, with ordinary client state.
export function LikeButton({ label }: LikeButtonProps) {
  const [likes, setLikes] = useState(0);

  return (
    <button
      class="action-button"
      data-like-island={label}
      events={[on("click", () => setLikes((value) => value + 1))]}
      type="button"
    >
      Like ({likes})
    </button>
  );
}
