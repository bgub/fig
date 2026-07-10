import { fileURLToPath } from "node:url";
import { figRefresh } from "@bgub/fig-vite";
import { defineConfig } from "vite-plus";

const pkg = (relative: string): string =>
  fileURLToPath(new URL(`../../packages/${relative}`, import.meta.url));

export default defineConfig({
  server: { port: 4300 },
  preview: { port: 4300 },
  // Resolve Fig packages to source (like the rest of the monorepo's dev), so the
  // dev server needs no prior build and Fig itself is debuggable/HMR-able.
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
        find: "@bgub/fig-dom/refresh",
        replacement: pkg("fig-dom/src/refresh.ts"),
      },
      { find: "@bgub/fig-dom", replacement: pkg("fig-dom/src/index.ts") },
      {
        find: "@bgub/fig-reconciler/refresh",
        replacement: pkg("fig-reconciler/src/refresh.ts"),
      },
      {
        find: "@bgub/fig-reconciler",
        replacement: pkg("fig-reconciler/src/index.ts"),
      },
      {
        find: "@bgub/fig-refresh",
        replacement: pkg("fig-refresh/src/index.ts"),
      },
      { find: "@bgub/fig", replacement: pkg("fig/src/index.ts") },
    ],
  },
  // Only transform this app's own components for Fast Refresh (not Fig source).
  plugins: [figRefresh({ include: /\/apps\/demo-hmr\/src\/.*\.[jt]sx?$/ })],
  // Fig dev-only paths (diagnostics, DevTools emission, refresh matching)
  // compile in through the __FIG_DEV__ gate; NODE_ENV covers bundled deps.
  define: {
    __FIG_DEV__: JSON.stringify(true),
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  esbuild: { jsx: "automatic", jsxImportSource: "@bgub/fig" },
});
