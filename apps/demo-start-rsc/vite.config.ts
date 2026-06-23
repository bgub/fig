import { fileURLToPath } from "node:url";
import { figStart } from "@bgub/fig-start/vite";
import { defineConfig } from "vite-plus";

const pkg = (relative: string): string =>
  fileURLToPath(new URL(`../../packages/${relative}`, import.meta.url));

// Resolve Fig packages to source (monorepo dev convention) so no prebuild is
// needed and ids/transforms run against real source.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@bgub/fig/jsx-runtime",
        replacement: pkg("fig/src/jsx-runtime.ts"),
      },
      {
        find: "@bgub/fig/jsx-dev-runtime",
        replacement: pkg("fig/src/jsx-runtime.ts"),
      },
      { find: "@bgub/fig/internal", replacement: pkg("fig/src/internal.ts") },
      {
        find: "@bgub/fig-server/rsc",
        replacement: pkg("fig-server/src/rsc.ts"),
      },
      { find: "@bgub/fig-server", replacement: pkg("fig-server/src/index.ts") },
      {
        find: "@bgub/fig-start/server",
        replacement: pkg("fig-start/src/server.ts"),
      },
      {
        find: "@bgub/fig-start/client",
        replacement: pkg("fig-start/src/client.ts"),
      },
      { find: "@bgub/fig-start", replacement: pkg("fig-start/src/index.ts") },
      { find: "@bgub/fig-dom", replacement: pkg("fig-dom/src/index.ts") },
      { find: "@bgub/fig-data", replacement: pkg("fig-data/src/index.ts") },
      {
        find: "@bgub/fig-reconciler",
        replacement: pkg("fig-reconciler/src/index.ts"),
      },
      {
        find: "@bgub/fig-scheduler",
        replacement: pkg("fig-scheduler/src/index.ts"),
      },
      { find: "@bgub/fig", replacement: pkg("fig/src/index.ts") },
    ],
  },
  plugins: [figStart()],
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  esbuild: { jsx: "automatic", jsxImportSource: "@bgub/fig" },
});
