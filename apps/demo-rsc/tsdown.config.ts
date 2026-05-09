import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const sourcePath = (path: string) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig([
  {
    entry: ["./src/server.tsx"],
    alias: {
      "@bgub/fig/jsx-runtime": sourcePath("packages/fig/src/jsx-runtime.ts"),
      "@bgub/fig": sourcePath("packages/fig/src/index.ts"),
      "@bgub/fig-server": sourcePath("packages/fig-server/src/index.ts"),
      "@bgub/fig-server/rsc": sourcePath("packages/fig-server/src/rsc.ts"),
    },
    platform: "node",
    format: "esm",
    noExternal: [/^@bgub\/fig/],
    dts: false,
    minify: false,
    sourcemap: true,
  },
  {
    entry: ["./src/client.tsx"],
    alias: {
      "@bgub/fig/jsx-runtime": sourcePath("packages/fig/src/jsx-runtime.ts"),
      "@bgub/fig": sourcePath("packages/fig/src/index.ts"),
      "@bgub/fig-dom": sourcePath("packages/fig-dom/src/index.ts"),
      "@bgub/fig-reconciler": sourcePath(
        "packages/fig-reconciler/src/index.ts",
      ),
      "@bgub/fig-scheduler": sourcePath("packages/fig-scheduler/src/index.ts"),
      "@bgub/fig-server/rsc": sourcePath("packages/fig-server/src/rsc.ts"),
    },
    platform: "browser",
    format: "esm",
    noExternal: [/^@bgub\/fig/],
    dts: false,
    minify: false,
    sourcemap: true,
    clean: false,
  },
]);
