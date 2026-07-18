import { hydrateStart } from "@bgub/fig-tanstack-start/client";
import "../style.css";

await hydrateStart();
document.body.dataset.figHydrated = "true";
