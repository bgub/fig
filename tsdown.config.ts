import { relative } from "node:path";
import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";
import {
  figSourceAliases,
  workspacePath,
} from "./scripts/lib/fig-source-aliases.ts";

import {
  libraries,
  libraryEntries,
  developmentLibraryPaths,
} from "./scripts/lib/library-entries.ts";

const workspaceRoot = workspacePath(".");
const packagePath =
  relative(workspaceRoot, process.cwd()).replaceAll("\\", "/") || ".";
const isDevSourcePack = process.env.FIG_DEV_SOURCE === "1";
const sourceAliases = figSourceAliases();
const figPackages = /^@bgub\/fig/;
const reactPackages = /^react/;
const tanstackPackages = /^@tanstack\//;
const browserLibraries = new Set(
  Object.keys(libraries).filter((path) => libraries[path]!.browser),
);
const developmentLibraries = new Set(developmentLibraryPaths);
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

const stripDeclarationMapComments = `node ${workspacePath("scripts/strip-declaration-map-comments.mjs")} dist`;

const packageConfig = packConfigFor(packagePath);
export default defineConfig(
  packageConfig === undefined ? {} : withPackageCwd(packageConfig),
);

type PackConfig = UserConfig | UserConfig[];

function packConfigFor(path: string): PackConfig | undefined {
  const libraryEntry = libraryEntries[path];
  if (libraryEntry !== undefined) {
    const browser = browserLibraries.has(path);
    const config: UserConfig = {
      entry: libraryEntry,
      dts: {
        tsconfig: workspacePath("tsconfig.build.json"),
      },
      deps:
        path === "packages/fig-tanstack-start"
          ? { neverBundle: [/^virtual:fig-tanstack-start\//] }
          : undefined,
      minify: browser ? true : undefined,
      platform: browser ? "browser" : undefined,
      sourcemap: true,
    };
    const primary = {
      ...config,
      define: isDevSourcePack ? figDevDefine : figProductionDefine,
      onSuccess: stripDeclarationMapComments,
    };
    return developmentLibraries.has(path)
      ? [
          primary,
          {
            ...config,
            define: figDevDefine,
            dts: false,
            outDir: "dist-development",
          },
        ]
      : primary;
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
          deps: isDevSourcePack
            ? { alwaysBundle: [figPackages] }
            : { neverBundle: [figPackages] },
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
    default:
      return undefined;
  }
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
