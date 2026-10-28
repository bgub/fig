// The route generator recognizes the framework import; the Fig plugin rewrites it.
import { createFileRoute } from "@tanstack/solid-router";
import { createServerOnlyFn } from "@bgub/fig-tanstack-start";
import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
import { Counter } from "../counter.jsx";

const checkServerEntry = createServerOnlyFn(async () => {
  const server = await import("@bgub/fig-tanstack-start/server");
  if (typeof server.renderPayloadResponse !== "function") {
    throw new Error("The packed Start server entry is unavailable.");
  }
});

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof document === "undefined") await checkServerEntry();
  },
  component: Home,
});

function Home() {
  if (typeof Isomorphic !== "function") {
    throw new Error("The packed Start payload entry is unavailable.");
  }
  return <Counter />;
}
