import { redirect } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/legacy-users")({
  beforeLoad: () => {
    throw redirect({ to: "/users" });
  },
});
