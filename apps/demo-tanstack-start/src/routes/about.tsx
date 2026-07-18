import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "Architecture · Fig Start" }] }),
});
