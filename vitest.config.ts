import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@bgub/fig/jsx-runtime",
        replacement: `${root}packages/fig/src/jsx-runtime.ts`,
      },
      {
        find: "@bgub/fig-devtools",
        replacement: `${root}packages/fig-devtools/src/index.ts`,
      },
      {
        find: "@bgub/fig-dom",
        replacement: `${root}packages/fig-dom/src/index.ts`,
      },
      {
        find: "@bgub/fig-reconciler",
        replacement: `${root}packages/fig-reconciler/src/index.ts`,
      },
      {
        find: "@bgub/fig-scheduler",
        replacement: `${root}packages/fig-scheduler/src/index.ts`,
      },
      {
        find: "@bgub/fig-server",
        replacement: `${root}packages/fig-server/src/index.ts`,
      },
      {
        find: "@bgub/fig",
        replacement: `${root}packages/fig/src/index.ts`,
      },
    ],
  },
  test: {
    coverage: {
      provider: "istanbul",
      reporter: ["lcov"],
      include: ["src/**/*.ts"],
      thresholds: {
        branches: 75,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
});
