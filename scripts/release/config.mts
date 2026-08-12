import { tegami } from "tegami";
import { github } from "tegami/plugins/github";
import { jsrRelease } from "./jsr.mts";

export const runtimePackageNames = [
  "@bgub/fig",
  "@bgub/fig-reconciler",
  "@bgub/fig-dom",
  "@bgub/fig-server",
] as const;

export const toolingPackageNames = [
  "@bgub/fig-refresh",
  "@bgub/fig-vite",
] as const;

export const tanstackPackageNames = [
  "@bgub/fig-tanstack-router",
  "@bgub/fig-tanstack-start",
] as const;

export const jsrPackageNames = [
  ...runtimePackageNames,
  "@bgub/fig-refresh",
] as const;

export const publicPackageNames = [
  ...runtimePackageNames,
  ...toolingPackageNames,
  ...tanstackPackageNames,
] as const;

export function createFigRelease(cwd = process.cwd()) {
  return tegami({
    cwd,
    groups: {
      fig: {
        syncBump: true,
        syncGitTag: true,
        npm: { distTag: "latest" },
      },
      "fig-tooling": {
        syncBump: true,
        syncGitTag: true,
        npm: { distTag: "latest" },
      },
      "fig-tanstack": {
        syncBump: true,
        syncGitTag: true,
        npm: { distTag: "latest" },
      },
    },
    ignore: [
      "fig",
      "@bgub/fig-demo-client",
      "@bgub/fig-demo-hmr",
      "@bgub/fig-demo-payload",
      "@bgub/fig-demo-ssr",
      "@bgub/fig-demo-tanstack-router",
      "@bgub/fig-demo-tanstack-start",
      "@bgub/fig-devtools",
      "@bgub/fig-ui",
    ],
    npm: {
      client: "pnpm",
      onBreakPeerDep: "set",
      trustedPublish: {
        provider: "github",
        workflow: "publish.yml",
      },
      updateLockFile: true,
    },
    packages: {
      "@bgub/fig": { group: "fig" },
      "@bgub/fig-dom": { group: "fig" },
      "@bgub/fig-reconciler": { group: "fig" },
      "@bgub/fig-server": { group: "fig" },
      "@bgub/fig-refresh": { group: "fig-tooling" },
      "@bgub/fig-vite": { group: "fig-tooling" },
      "@bgub/fig-tanstack-router": { group: "fig-tanstack" },
      "@bgub/fig-tanstack-start": { group: "fig-tanstack" },
    },
    plugins: [
      jsrRelease({ publishOrder: jsrPackageNames }),
      github({
        repo: "bgub/fig",
        versionPr: { base: "main" },
      }),
    ],
  });
}
