import { startServer } from "@bgub/fig-start/server";
import { routes } from "./routes.ts";
import { styles } from "./styles.ts";

startServer({
  // Lets the framework serve the built client bundle next to this server module.
  appUrl: import.meta.url,
  context: () => ({ appName: "Fig Start" }),
  head: (
    <>
      <title>Fig Start</title>
      <meta name="description" content="Fig full-stack framework demo." />
    </>
  ),
  routes,
  styles,
});
