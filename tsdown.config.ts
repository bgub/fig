import { relative } from "node:path";
import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";
import { figStart } from "./packages/fig-start/src/vite/index.ts";
import {
  figSourceAliases,
  workspacePath,
} from "./scripts/lib/fig-source-aliases.ts";

const workspaceRoot = workspacePath(".");
const packagePath =
  relative(workspaceRoot, process.cwd()).replaceAll("\\", "/") || ".";
const isDevSourcePack = process.env.FIG_DEV_SOURCE === "1";
const sourceAliases = figSourceAliases();
const figPackages = /^@bgub\/fig/;
const reactPackages = /^react/;
const tanstackPackages = /^@tanstack\//;
const libraryEntries: Record<string, string[] | Record<string, string>> = {
  "packages/fig": [
    "./src/index.ts",
    "./src/internal.ts",
    "./src/jsx-runtime.ts",
    "./src/payload.ts",
    "./src/server.ts",
    "./src/server.browser.ts",
  ],
  "packages/fig-devtools": [
    "./src/index.ts",
    "./src/server.ts",
    "./src/client.ts",
  ],
  "packages/fig-dom": [
    "./src/index.ts",
    "./src/refresh.ts",
    "./src/act.ts",
    "./src/jsx-runtime.ts",
  ],
  "packages/fig-reconciler": [
    "./src/index.ts",
    "./src/devtools.ts",
    "./src/refresh.ts",
    "./src/act.ts",
  ],
  "packages/fig-refresh": ["./src/index.ts"],
  "packages/fig-vite": ["./src/index.ts"],
  "packages/fig-server": [
    "./src/index.ts",
    "./src/html-entry.ts",
    "./src/payload.ts",
  ],
  "packages/fig-start": [
    "./src/cli.ts",
    "./src/index.ts",
    "./src/server.ts",
    "./src/client.ts",
    "./src/dev-server.ts",
    "./src/internal.ts",
    "./src/vite/index.ts",
  ],
  "packages/fig-tanstack-router": ["./src/router.tsx"],
  "packages/fig-tanstack-start": {
    data: "./src/data.ts",
    client: "./src/client.tsx",
    "default-entry/client": "./src/default-entry/client.ts",
    "default-entry/server": "./src/default-entry/server.ts",
    "default-entry/start": "./src/default-entry/start.ts",
    payload: "./src/payload.ts",
    server: "./src/server.tsx",
    "storage-context": "./src/storage-context.ts",
    "plugin/vite": "./src/plugin/vite.ts",
  },
};
const browserLibraries = new Set(["packages/fig-devtools", "packages/fig-dom"]);
const figDevDefine = { __FIG_DEV__: JSON.stringify(true) };
const figProductionDefine = { __FIG_DEV__: JSON.stringify(false) };
// Demos are dev-mode showcases: Fig dev diagnostics and DevTools emission stay
// in, and bundled React (demo-client) runs its development build. Server
// entries take only the Fig gate so NODE_ENV stays a runtime concern on node.
const demoBrowserDefine = {
  ...figDevDefine,
  "process.env.NODE_ENV": JSON.stringify("development"),
};
// Enforcement lives next to the grant: browser demo entries assert after
// every pack (watch builds included) that the dev define survived into the
// bundle — unit tests run source-linked with the dev define and cannot see a
// stripped bundle. Targets are relative to the app's cwd.
function assertDevBundle(target: string): string {
  return `node ${workspacePath("scripts/assert-dev-bundle.mjs")} ${target}`;
}
const packageConfig = packConfigFor(packagePath);
export default defineConfig(
  packageConfig === undefined ? {} : withPackageCwd(packageConfig),
);

type PackConfig = UserConfig | UserConfig[];

function packConfigFor(path: string): PackConfig | undefined {
  const libraryEntry = libraryEntries[path];
  if (libraryEntry !== undefined) {
    const browser = browserLibraries.has(path);
    return {
      entry: libraryEntry,
      dts: true,
      // Monorepo dev (FIG_DEV_SOURCE=1) builds the libraries with __DEV__ on so
      // the fig-start dev server — which consumes these built packages — gets
      // strict diagnostics and DevTools commit emission. Publishing builds
      // (flag unset) stay production, preserving dead-code elimination.
      define: isDevSourcePack ? figDevDefine : figProductionDefine,
      minify: browser ? true : undefined,
      platform: browser ? "browser" : undefined,
      sourcemap: true,
    };
  }

  switch (path) {
    case "apps/demo-tanstack-router":
      return {
        entry: ["./src/main.tsx"],
        alias: sourceAliases,
        css: {
          transformer: "postcss",
        },
        define: demoBrowserDefine,
        onSuccess: assertDevBundle("dist/main.js"),
        platform: "browser",
        deps: {
          alwaysBundle: [figPackages, tanstackPackages],
        },
        sourcemap: true,
      };
    case "apps/demo-client":
      return demoClientPackConfig();
    case "apps/demo-payload":
      return [
        {
          entry: ["./src/server.tsx"],
          alias: sourceAliases,
          define: figDevDefine,
          platform: "node",
          deps: {
            alwaysBundle: [figPackages],
          },
          css: {
            transformer: "postcss",
          },
          sourcemap: true,
        },
        {
          entry: ["./src/client.tsx"],
          alias: sourceAliases,
          define: demoBrowserDefine,
          onSuccess: assertDevBundle("dist/client.js"),
          platform: "browser",
          deps: {
            alwaysBundle: [figPackages],
          },
          css: {
            transformer: "postcss",
          },
          sourcemap: true,
          clean: false,
        },
      ];
    case "apps/demo-ssr":
      return [
        {
          entry: ["./src/server.tsx"],
          alias: isDevSourcePack ? sourceAliases : undefined,
          define: figDevDefine,
          deps: figServerDeps(),
          platform: "node",
          sourcemap: true,
        },
        {
          entry: ["./src/client.tsx"],
          alias: sourceAliases,
          define: demoBrowserDefine,
          onSuccess: assertDevBundle("dist/client.js"),
          platform: "browser",
          deps: {
            alwaysBundle: [figPackages],
          },
          sourcemap: true,
          clean: false,
        },
      ];
    case "apps/demo-start":
      return [
        {
          entry: {
            "dev-server": "./src/dev-server.ts",
            server: "virtual:fig-start/server-entry",
          },
          alias: isDevSourcePack ? sourceAliases : undefined,
          define: figDevDefine,
          deps: figServerDeps(),
          platform: "node",
          plugins: [figStart({ tailwind: true, target: "server" })],
          sourcemap: true,
        },
        {
          entry: { client: "virtual:fig-start/client-entry" },
          alias: sourceAliases,
          define: figDevDefine,
          onSuccess: assertDevBundle("dist"),
          platform: "browser",
          deps: {
            alwaysBundle: [figPackages],
          },
          plugins: [
            figStart({
              clientNodeEnv: "development",
              tailwind: true,
              target: "client",
            }),
          ],
          sourcemap: true,
          clean: false,
        },
      ];
    default:
      return undefined;
  }
}

function figServerDeps() {
  return isDevSourcePack
    ? { alwaysBundle: [figPackages] }
    : { neverBundle: [figPackages] };
}

function demoClientPackConfig(): PackConfig {
  return {
    entry: ["./src/main.tsx"],
    alias: sourceAliases,
    platform: "browser",
    deps: {
      alwaysBundle: [figPackages, reactPackages],
    },
    define: demoBrowserDefine,
    onSuccess: assertDevBundle("dist/main.js"),
    sourcemap: true,
  };
}

function withPackageCwd(config: PackConfig): PackConfig {
  if (Array.isArray(config)) {
    return config.map(withBuildDefaults);
  }

  return withBuildDefaults(config);
}

function withBuildDefaults(config: UserConfig): UserConfig {
  return {
    cwd: process.cwd(),
    dts: false,
    outExtensions: () => ({ js: ".js" }),
    ...config,
  };
}
