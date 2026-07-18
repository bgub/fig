import { Outlet } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/users")({ component: Outlet });
