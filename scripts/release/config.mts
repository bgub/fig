import { tegami } from "tegami";
import { github } from "tegami/plugins/github";
import { jsrRelease } from "./jsr.mts";

export const jsrPackageNames = [
  "@bgub/fig",
  "@bgub/fig-reconciler",
  "@bgub/fig-dom",
  "@bgub/fig-refresh",
  "@bgub/fig-server",
] as const;

export const publicPackageNames = [
  ...jsrPackageNames,
  "@bgub/fig-tanstack-router",
] as const;

export function createFigRelease(cwd = process.cwd()) {
  return tegami({
    cwd,
    groups: {
      fig: {
        prerelease: "alpha",
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
      "@bgub/fig-demo-start",
      "@bgub/fig-demo-tanstack-router",
      "@bgub/fig-devtools",
      "@bgub/fig-start",
      "@bgub/fig-vite",
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
      "@bgub/fig-refresh": { group: "fig" },
      "@bgub/fig-server": { group: "fig" },
      "@bgub/fig-tanstack-router": { group: "fig" },
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
