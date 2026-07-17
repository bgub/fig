import { useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import type { LikeButtonProps } from "./resource-shared.ts";

// The demo's interactive island: decoded out of the serialized post via
// resolveClientReference, with ordinary client state. Its frame is the
// visible marker that this subtree runs in the browser.
export function LikeButton({ label }: LikeButtonProps) {
  const [likes, setLikes] = useState(0);

  return (
    <span class="frame frame-island">
      <span class="tag">client island</span>
      <button
        class="island-button"
        data-like-island={label}
        mix={[on("click", () => setLikes((value) => value + 1))]}
        type="button"
      >
        Like ({likes})
      </button>
    </span>
  );
}
