import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sourcePath = (path: string) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  esbuild: {
    jsxDev: false,
  },
  resolve: {
    alias: [
      {
        find: "@bgub/fig/jsx-runtime",
        replacement: sourcePath("packages/fig/src/jsx-runtime.ts"),
      },
      {
        find: "@bgub/fig",
        replacement: sourcePath("packages/fig/src/index.ts"),
      },
      {
        find: "@bgub/fig-dom",
        replacement: sourcePath("packages/fig-dom/src/index.ts"),
      },
      {
        find: "@bgub/fig-reconciler",
        replacement: sourcePath("packages/fig-reconciler/src/index.ts"),
      },
      {
        find: "@bgub/fig-scheduler",
        replacement: sourcePath("packages/fig-scheduler/src/index.ts"),
      },
      {
        find: "@bgub/fig-server",
        replacement: sourcePath("packages/fig-server/src/index.ts"),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
