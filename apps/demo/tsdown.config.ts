import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/main.tsx"],
  platform: "browser",
  noExternal: [/^@bgub\/fig/, /^react/, /^react-dom/],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  dts: false,
  minify: false,
  sourcemap: true,
});
