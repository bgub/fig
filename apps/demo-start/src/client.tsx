import "./dev-env.ts";
import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { routes } from "./routes.ts";

hydrateStart({
  context: { appName: "Fig Start" },
  loadClientReference,
  onRecoverableError(error) {
    document.body.dataset.recoverableHydrationError =
      error instanceof Error ? error.message : String(error);
  },
  routes,
});

document.body.dataset.figHydrated = "true";
