import { relative } from "node:path";
import { defineConfig } from "vitest/config";
import {
  figSourceResolveAliases,
  workspacePath,
} from "./tooling/fig-source-aliases.ts";

const packagePath =
  relative(workspacePath("."), process.cwd()).replaceAll("\\", "/") || ".";

export default defineConfig({
  resolve: {
    alias: figSourceResolveAliases(),
  },
  define: {
    __FIG_DEV__: JSON.stringify(true),
  },
  test: {
    include:
      packagePath === "."
        ? ["packages/*/src/**/*.test.{ts,tsx}", "apps/*/src/**/*.test.{ts,tsx}"]
        : ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "istanbul",
      reporter: ["lcov"],
      include:
        packagePath === "." ? ["packages/*/src/**/*.ts"] : ["src/**/*.ts"],
      thresholds: {
        branches: 75,
        functions: 85,
        lines: 85,
        statements: 80,
      },
    },
  },
});
