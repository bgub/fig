import { fileURLToPath } from "node:url";

const entries = [
  ["@bgub/fig/jsx-runtime", "packages/fig/src/jsx-runtime.ts"],
  ["@bgub/fig/jsx-dev-runtime", "packages/fig/src/jsx-runtime.ts"],
  ["@bgub/fig/internal", "packages/fig/src/internal.ts"],
  ["@bgub/fig/payload", "packages/fig/src/payload.ts"],
  ["@bgub/fig/server", "packages/fig/src/server.ts"],
  ["@bgub/fig-devtools/server", "packages/fig-devtools/src/server.ts"],
  ["@bgub/fig-devtools/client", "packages/fig-devtools/src/client.ts"],
  ["@bgub/fig-devtools", "packages/fig-devtools/src/index.ts"],
  ["@bgub/fig-dom/test-utils", "packages/fig-dom/src/act.ts"],
  ["@bgub/fig-dom/refresh", "packages/fig-dom/src/refresh.ts"],
  ["@bgub/fig-dom/jsx-runtime", "packages/fig-dom/src/jsx-runtime.ts"],
  ["@bgub/fig-dom/jsx-dev-runtime", "packages/fig-dom/src/jsx-runtime.ts"],
  ["@bgub/fig-dom", "packages/fig-dom/src/index.ts"],
  ["@bgub/fig-reconciler/devtools", "packages/fig-reconciler/src/devtools.ts"],
  ["@bgub/fig-reconciler/refresh", "packages/fig-reconciler/src/refresh.ts"],
  ["@bgub/fig-reconciler", "packages/fig-reconciler/src/index.ts"],
  ["@bgub/fig-refresh", "packages/fig-refresh/src/index.ts"],
  ["@bgub/fig-vite", "packages/fig-vite/src/index.ts"],
  ["@bgub/fig-server/html", "packages/fig-server/src/html-entry.ts"],
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

export function figSourceAliases(): Record<string, string> {
  return Object.fromEntries(
    [...entries]
      .sort(([a], [b]) => b.length - a.length)
      .map(([name, path]) => [name, workspacePath(path)]),
  );
}

export function figSourceResolveAliases(): Array<{
  find: RegExp;
  replacement: string;
}> {
  return entries.map(([name, path]) => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: workspacePath(path),
  }));
}

export function workspacePath(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url));
}
