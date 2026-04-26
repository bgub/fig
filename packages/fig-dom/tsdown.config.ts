import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  platform: "browser",
  dts: true,
  minify: true,
  sourcemap: true,
});
