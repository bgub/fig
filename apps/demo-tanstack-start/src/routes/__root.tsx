import { type FigNode, readData } from "@bgub/fig";
import {
  createRootRouteWithContext,
  ensureRouteData,
} from "@bgub/fig-tanstack-router";
import type { StartDataContext } from "@bgub/fig-tanstack-start";
import styleUrl from "../../style.css?url";
import { Document, NotFound } from "../app-shell.tsx";
import { initialThemeResource } from "../data.ts";

export const Route = createRootRouteWithContext<StartDataContext>()({
  component: RootDocument,
  head: () => ({
    links: [{ href: styleUrl, precedence: "app", rel: "stylesheet" }],
    meta: [
      { title: "Fig TanStack Start" },
      {
        content: "Fig running on TanStack Start.",
        name: "description",
      },
    ],
  }),
  loader: ({ context }) => ensureRouteData(context, initialThemeResource),
  notFoundComponent: NotFound,
});

function RootDocument(): FigNode {
  const initialTheme = readData(initialThemeResource);
  return <Document initialTheme={initialTheme} />;
}
