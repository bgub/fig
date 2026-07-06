import type { StartConfig } from "@bgub/fig-start";
import { routes } from "./routes.ts";
import { themeFromCookie } from "./theme.ts";
import "./styles.css";

export const start = {
  appName: "Fig Start",
  html: (request) => ({
    class: themeFromCookie(request.headers.get("cookie")),
    suppressHydrationWarning: true,
  }),
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
