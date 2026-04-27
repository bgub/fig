import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/main.tsx"],
  platform: "browser",
  noExternal: [/^@bgub\/fig/],
  dts: false,
  minify: false,
  sourcemap: true,
});
