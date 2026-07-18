import { createRootRouteWithContext } from "@bgub/fig-tanstack-router";
import type { StartDataContext } from "@bgub/fig-tanstack-start";
import styleUrl from "../../style.css?url";
import { Document, NotFound } from "../app-shell.tsx";

export const Route = createRootRouteWithContext<StartDataContext>()({
  component: Document,
  head: () => ({
    links: [{ href: styleUrl, precedence: "app", rel: "stylesheet" }],
    meta: [
      { title: "Fig × TanStack Start" },
      {
        content: "A streamed TanStack Start runtime demo rendered by Fig.",
        name: "description",
      },
    ],
  }),
  notFoundComponent: NotFound,
});
