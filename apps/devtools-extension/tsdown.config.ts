import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/devtools.ts",
    "./src/panel.ts",
    "./src/content-script.ts",
    "./src/service-worker.ts",
    "./src/hook.ts",
  ],
  platform: "browser",
  noExternal: [/^@bgub\/fig-devtools/],
});
