import "./dev-env.ts";
import type { StartConfig } from "@bgub/fig-start";
import { routes } from "./routes.ts";
import { styles } from "./styles.ts";

export const start = {
  appName: "Fig Start",
  head: (
    <>
      <title>Fig Start</title>
      <meta name="description" content="Fig full-stack framework demo." />
    </>
  ),
  onRecoverableError(error) {
    console.error("[fig-start] recoverable hydration error:", error);
  },
  routes,
  styles,
} satisfies StartConfig;
