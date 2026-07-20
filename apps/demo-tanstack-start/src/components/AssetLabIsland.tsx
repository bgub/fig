import { type FigNode, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import styles from "./AssetLabIsland.module.css";
import markHref from "./client-mark.svg";

export function AssetLabIsland(): FigNode {
  const [count, setCount] = useState(0);

  return (
    <button
      class={styles.root}
      mix={on("click", () => setCount(count + 1))}
      type="button"
    >
      <img alt="" class={styles.mark} src={markHref} />
      <span class={styles.body}>
        <span class={styles.label}>Client asset island</span>
        <span class={styles.count}>clicks: {count}</span>
      </span>
    </button>
  );
}
