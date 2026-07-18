import { createFileRoute, Navigate } from "@tanstack/solid-router";

export const Route = createFileRoute("/component-redirect")({
  component: ComponentRedirect,
});

function ComponentRedirect() {
  return <Navigate to="/users" />;
}
