import type { AnyRoute } from "@bgub/fig-start";
import { Route as aboutRoute } from "./routes/about.tsx";
import { Route as dashboardRoute } from "./routes/dashboard.server.tsx";
import { Route as indexRoute } from "./routes/index.tsx";
import { Route as rootRoute } from "./routes/__root.tsx";

export const routes: AnyRoute[] = [
  rootRoute,
  indexRoute,
  aboutRoute,
  dashboardRoute,
];
