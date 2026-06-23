import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { routes } from "./routes.ts";

hydrateStart({ context: {}, loadClientReference, routes });

document.body.dataset.figHydrated = "true";
