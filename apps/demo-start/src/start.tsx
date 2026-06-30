import "./dev-env.ts";
import type { StartConfig } from "@bgub/fig-start";
import { clientReferenceAssets, demoAssets } from "./client-assets.ts";
import { routes } from "./routes.ts";
import styles from "./styles.css?raw";

export const start = {
  appName: "Fig Start",
  assets: {
    ...demoAssets,
    "/assets/global.css": {
      content: styles,
      contentType: "text/css; charset=utf-8",
    },
  },
  clientReferenceAssets,
  head: (
    <>
      <title>Fig Start</title>
      <meta name="description" content="Fig full-stack framework demo." />
      <link href="/assets/global.css" rel="stylesheet" />
    </>
  ),
  onRecoverableError(error) {
    console.error("[fig-start] recoverable hydration error:", error);
  },
  routes,
} satisfies StartConfig;
