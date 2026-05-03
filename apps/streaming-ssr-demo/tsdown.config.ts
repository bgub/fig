import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["./src/server.tsx"],
    platform: "node",
    format: "esm",
    dts: false,
    minify: false,
    sourcemap: true,
  },
  {
    entry: ["./src/client.tsx"],
    platform: "browser",
    format: "esm",
    noExternal: [/^@bgub\/fig/],
    dts: false,
    minify: false,
    sourcemap: true,
    clean: false,
  },
]);
