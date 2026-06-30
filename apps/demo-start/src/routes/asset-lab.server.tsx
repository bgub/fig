import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";
import { AssetLabIsland } from "../components/AssetLabIsland.tsx";
import styles from "./asset-lab.module.css";

export const Route = createFileRoute("/asset-lab")({
  component: AssetLab,
});

function AssetLab(): FigNode {
  return (
    <section class={styles.root}>
      <div class={styles.header}>
        <div>
          <h1 class={styles.title}>Asset lab</h1>
          <p class={styles.copy}>
            This server route imports its own CSS module, then renders a client
            island with a separate CSS module and SVG asset.
          </p>
        </div>
      </div>
      <AssetLabIsland />
    </section>
  );
}
