import type { FigNode } from "@bgub/fig";
import { createRootRouteWithContext } from "@bgub/fig-tanstack-router";
import type { StartDataContext } from "@bgub/fig-tanstack-start";
import styleUrl from "../../style.css?url";
import { Document, NotFound } from "../app-shell.tsx";
import { getInitialTheme } from "../server-functions.ts";

export const Route = createRootRouteWithContext<StartDataContext>()({
  component: RootDocument,
  head: () => ({
    links: [{ href: styleUrl, precedence: "app", rel: "stylesheet" }],
    meta: [
      { title: "Fig TanStack Start" },
      {
        content: "Fig Start reimplemented on TanStack Start.",
        name: "description",
      },
    ],
  }),
  loader: () => getInitialTheme(),
  notFoundComponent: NotFound,
});

function RootDocument(): FigNode {
  const initialTheme = Route.useLoaderData();
  return <Document initialTheme={initialTheme} />;
}
