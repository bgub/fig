import { type FigNode, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { islandMarkHref } from "./Island.assets.ts";
import styles from "./Island.module.css";

// Imported by a `.server.tsx` route, so the Start Vite plugin rewrites this
// component into a client reference for the RSC payload.
export function Island(): FigNode {
  const [count, setCount] = useState(0);
  return (
    <button
      class={styles.root}
      events={[on("click", () => setCount(count + 1))]}
    >
      <img alt="" class={styles.mark} src={islandMarkHref} />
      <span class={styles.body}>
        <span>Client island</span>
        <span class={styles.count}>clicks: {count}</span>
      </span>
    </button>
  );
}
