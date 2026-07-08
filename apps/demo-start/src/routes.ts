import type { AnyRoute } from "@bgub/fig-start";
import { Route as aboutRoute } from "./routes/about.tsx";
import { Route as assetLabRoute } from "./routes/asset-lab.server.tsx";
import { Route as dashboardRoute } from "./routes/dashboard.server.tsx";
import { Route as dataRoute } from "./routes/data.tsx";
import { Route as indexRoute } from "./routes/index.tsx";
import { Route as postRoute } from "./routes/posts/$postId.server.tsx";
import { Route as postsIndexRoute } from "./routes/posts/index.tsx";
import { Route as postsLayoutRoute } from "./routes/posts/route.tsx";
import { Route as rootRoute } from "./routes/__root.tsx";
import { Route as viewTransitionsRoute } from "./routes/view-transitions.tsx";

// M1 uses an explicit registry; the M2 Vite plugin will auto-discover these from
// the routes/ directory (and generate a fully typed route tree).
export const routes: AnyRoute[] = [
  rootRoute,
  indexRoute,
  aboutRoute,
  assetLabRoute,
  dashboardRoute,
  dataRoute,
  viewTransitionsRoute,
  postsLayoutRoute,
  postsIndexRoute,
  postRoute,
];
