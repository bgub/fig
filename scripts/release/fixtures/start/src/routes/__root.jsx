import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@bgub/fig-tanstack-router";
import { StartScripts } from "@bgub/fig-tanstack-start";

export const Route = createRootRouteWithContext()({ component: Document });

function Document() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <StartScripts />
      </body>
    </html>
  );
}
