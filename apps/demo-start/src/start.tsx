import type { StartConfig } from "@bgub/fig-start";
import { clientReferenceAssets, demoAssets } from "./client-assets.ts";
import { routes } from "./routes.ts";
import "./styles.css";

export const start = {
  appName: "Fig Start",
  assets: demoAssets,
  clientReferenceAssets,
  head: (
    <>
      <title>Fig Start</title>
      <meta name="description" content="Fig full-stack framework demo." />
      <link href="/style.css" rel="stylesheet" />
    </>
  ),
  onRecoverableError(error) {
    console.error("[fig-start] recoverable hydration error:", error);
  },
  routes,
} satisfies StartConfig;
