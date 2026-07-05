import type { StartConfig } from "@bgub/fig-start";
import { postService } from "./data.ts";
import { routes } from "./routes.ts";
import "./styles.css";

export const start = {
  appName: "Fig Start",
  dataContext: () => ({ posts: postService }),
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
