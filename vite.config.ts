import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import type { UserConfig } from "vite-plus";
import { figStart } from "./packages/fig-start/src/vite/index.ts";

const workspaceRoot = workspacePath(".");
const packagePath =
  relative(workspaceRoot, process.cwd()).replaceAll("\\", "/") || ".";
const isPackCommand = process.argv.some((arg) => arg.includes("pack-bin"));
const figSourceAliasEntries = [
  ["@bgub/fig/jsx-runtime", "packages/fig/src/jsx-runtime.ts"],
  ["@bgub/fig/jsx-dev-runtime", "packages/fig/src/jsx-runtime.ts"],
  ["@bgub/fig/internal", "packages/fig/src/internal.ts"],
  ["@bgub/fig/server", "packages/fig/src/server.ts"],
  ["@bgub/fig-devtools", "packages/fig-devtools/src/index.ts"],
  ["@bgub/fig-dom/refresh", "packages/fig-dom/src/refresh.ts"],
  ["@bgub/fig-dom", "packages/fig-dom/src/index.ts"],
  ["@bgub/fig-reconciler/devtools", "packages/fig-reconciler/src/devtools.ts"],
  ["@bgub/fig-reconciler/refresh", "packages/fig-reconciler/src/refresh.ts"],
  ["@bgub/fig-reconciler", "packages/fig-reconciler/src/index.ts"],
  ["@bgub/fig-refresh", "packages/fig-refresh/src/index.ts"],
  ["@bgub/fig-vite", "packages/fig-vite/src/index.ts"],
  ["@bgub/fig-server/payload", "packages/fig-server/src/payload.ts"],
  ["@bgub/fig-server", "packages/fig-server/src/index.ts"],
  ["@bgub/fig-start/server", "packages/fig-start/src/server.ts"],
  ["@bgub/fig-start/client", "packages/fig-start/src/client.ts"],
  ["@bgub/fig-start/dev-server", "packages/fig-start/src/dev-server.ts"],
  ["@bgub/fig-start/internal", "packages/fig-start/src/internal.ts"],
  ["@bgub/fig-start/vite", "packages/fig-start/src/vite/index.ts"],
  ["@bgub/fig-start", "packages/fig-start/src/index.ts"],
  ["@bgub/fig", "packages/fig/src/index.ts"],
] as const;
const sourceAliases = figSourceAliasMap();
const outExtensions = () => ({ js: ".js", dts: ".d.ts" });
const figPackages = /^@bgub\/fig/;
const reactPackages = /^react/;
const reactDomPackages = /^react-dom/;
const demoClientBundleDependencies = [
  figPackages,
  reactPackages,
  reactDomPackages,
];
const libraryEntries: Record<string, string[]> = {
  "packages/fig": [
    "./src/index.ts",
    "./src/internal.ts",
    "./src/jsx-runtime.ts",
    "./src/server.ts",
  ],
  "packages/fig-devtools": ["./src/index.ts"],
  "packages/fig-dom": ["./src/index.ts", "./src/refresh.ts"],
  "packages/fig-reconciler": [
    "./src/index.ts",
    "./src/devtools.ts",
    "./src/refresh.ts",
  ],
  "packages/fig-refresh": ["./src/index.ts"],
  "packages/fig-vite": ["./src/index.ts"],
  "packages/fig-server": ["./src/index.ts", "./src/payload.ts"],
  "packages/fig-start": [
    "./src/index.ts",
    "./src/server.ts",
    "./src/client.ts",
    "./src/dev-server.ts",
    "./src/internal.ts",
    "./src/vite/index.ts",
  ],
};
const browserLibraries = new Set(["packages/fig-devtools", "packages/fig-dom"]);
const packWorkspacePaths = [
  "packages/fig",
  "packages/fig-server",
  "packages/fig-reconciler",
  "packages/fig-refresh",
  "packages/fig-vite",
  "packages/fig-dom",
  "packages/fig-devtools",
  "packages/fig-start",
];

export default defineConfig({
  fmt: {
    printWidth: 80,
    sortPackageJson: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  resolve: {
    alias: figSourceResolveAliases(),
  },
  test: testConfigFor(packagePath),
  pack:
    packagePath === "." && !isPackCommand
      ? undefined
      : packConfigFor(packagePath),
});

type PackConfig = NonNullable<UserConfig["pack"]>;
type TestConfig = NonNullable<UserConfig["test"]>;

function workspacePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

// vp pack only accepts Record<string, string> aliases, whose string keys
// prefix-match; sort longest-first so a bare package alias can never shadow
// a subpath entry, making the source order of figSourceAliasEntries
// irrelevant for both consumers.
function figSourceAliasMap(): Record<string, string> {
  return Object.fromEntries(
    [...figSourceAliasEntries]
      .sort(([a], [b]) => b.length - a.length)
      .map(([find, path]) => [find, workspacePath(path)]),
  );
}

// resolve.alias supports regexes, so exact-match anchoring gives the same
// order-independence directly.
function figSourceResolveAliases(): Array<{
  find: RegExp;
  replacement: string;
}> {
  return figSourceAliasEntries.map(([find, path]) => ({
    find: exactImport(find),
    replacement: workspacePath(path),
  }));
}

function exactImport(id: string): RegExp {
  return new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

function testConfigFor(path: string): TestConfig {
  return {
    include:
      path === "."
        ? ["packages/*/src/**/*.test.{ts,tsx}", "apps/*/src/**/*.test.{ts,tsx}"]
        : ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "istanbul",
      reporter: ["lcov"],
      include: path === "." ? ["packages/*/src/**/*.ts"] : ["src/**/*.ts"],
      thresholds: {
        branches: 75,
        functions: 85,
        lines: 85,
        statements: 80,
      },
    },
  };
}

function packConfigFor(path: string): PackConfig | undefined {
  const libraryEntry = libraryEntries[path];
  if (libraryEntry !== undefined) {
    const browser = browserLibraries.has(path);
    return {
      entry: libraryEntry,
      dts: true,
      minify: browser ? true : undefined,
      outExtensions,
      platform: browser ? "browser" : undefined,
      sourcemap: true,
    };
  }

  switch (path) {
    case ".":
      return packWorkspacePaths.flatMap((workspacePackagePath) => {
        const config = packConfigFor(workspacePackagePath);
        if (config === undefined) return [];

        return withPackageCwd(config, workspacePackagePath);
      });
    case "apps/demo-client":
      return demoClientPackConfig();
    case "apps/demo-payload":
      return [
        {
          entry: ["./src/server.tsx"],
          alias: sourceAliases,
          platform: "node",
          format: "esm",
          deps: {
            alwaysBundle: [figPackages],
          },
          css: {
            transformer: "postcss",
          },
          dts: false,
          minify: false,
          outExtensions,
          sourcemap: true,
        },
        {
          entry: ["./src/client.tsx"],
          alias: sourceAliases,
          platform: "browser",
          format: "esm",
          deps: {
            alwaysBundle: [figPackages],
          },
          css: {
            transformer: "postcss",
          },
          dts: false,
          minify: false,
          sourcemap: true,
          clean: false,
        },
      ];
    case "apps/demo-ssr":
      return [
        {
          entry: ["./src/server.tsx"],
          deps: {
            neverBundle: [figPackages],
          },
          platform: "node",
          format: "esm",
          dts: false,
          minify: false,
          outExtensions,
          sourcemap: true,
        },
        {
          entry: ["./src/client.tsx"],
          alias: sourceAliases,
          platform: "browser",
          format: "esm",
          deps: {
            alwaysBundle: [figPackages],
          },
          dts: false,
          minify: false,
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
          deps: {
            neverBundle: [figPackages],
          },
          platform: "node",
          format: "esm",
          dts: false,
          minify: false,
          outExtensions,
          plugins: [figStart({ tailwind: true, target: "server" })],
          sourcemap: true,
        },
        {
          entry: { client: "virtual:fig-start/client-entry" },
          alias: sourceAliases,
          platform: "browser",
          format: "esm",
          deps: {
            alwaysBundle: [figPackages],
          },
          dts: false,
          minify: false,
          outExtensions,
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

function demoClientPackConfig(): PackConfig {
  return {
    entry: ["./src/main.tsx"],
    alias: sourceAliases,
    platform: "browser",
    deps: {
      alwaysBundle: demoClientBundleDependencies,
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    dts: false,
    minify: false,
    sourcemap: true,
  };
}

function withPackageCwd(config: PackConfig, cwd: string): PackConfig {
  if (Array.isArray(config)) {
    return config.map((entry) => ({ ...entry, cwd: workspacePath(cwd) }));
  }

  return { ...config, cwd: workspacePath(cwd) };
}
