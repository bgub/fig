import { describe, expect, it } from "vitest";
import type { Alias, EnvironmentOptions, UserConfig } from "vite";
import { tanstackStart } from "./vite.ts";

interface CompatibilityPlugin {
  config(): UserConfig;
  configEnvironment(
    environmentName: string,
    environment: EnvironmentOptions,
  ):
    | {
        build?: EnvironmentOptions["build"];
        optimizeDeps?: {
          exclude?: string[];
          include?: string[];
          rolldownOptions?: { plugins?: OptimizerPlugin[] };
        };
      }
    | undefined;
  configResolved(config: {
    environments: Record<
      string,
      { build: { assetsDir?: string; outDir?: string } }
    >;
    resolve: { alias: Alias[] };
    root: string;
  }): void;
  load(id: string): string | undefined;
  resolveId(source: string): string | undefined;
}

interface OptimizerPlugin {
  resolveId(source: string): { external: true; id: string } | null;
}

describe("tanstackStart", () => {
  it("installs Fig Fast Refresh after the route compiler", () => {
    expect(tanstackStart().at(-1)).toEqual(
      expect.objectContaining({ name: "fig:refresh" }),
    );
  });

  it("keeps Solid compatibility behind Fig module aliases", () => {
    const plugin = compatibilityPlugin();
    const aliases = plugin.config().resolve?.alias as Alias[];

    expect(aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          find: /^@tanstack\/solid-start$/,
          replacement: "@bgub/fig-tanstack-start",
        }),
        expect.objectContaining({
          find: /^@tanstack\/solid-router$/,
          replacement: "@bgub/fig-tanstack-router",
        }),
        expect.objectContaining({
          find: /^@tanstack\/start-storage-context$/,
        }),
      ]),
    );
  });

  it("keeps compiler-sensitive Start modules out of dependency prebundling", () => {
    const plugin = compatibilityPlugin();
    const config = plugin.configEnvironment("client", {
      optimizeDeps: {
        exclude: ["existing-exclude"],
        include: ["existing-include"],
      },
    });

    expect(config?.optimizeDeps?.include).toEqual([
      "existing-include",
      "@tanstack/router-core/ssr/client",
    ]);
    expect(config?.optimizeDeps?.exclude).toEqual([
      "existing-exclude",
      "@tanstack/start-client-core",
      "@tanstack/start-client-core/client",
      "@tanstack/start-client-core/client-rpc",
      "@bgub/fig-tanstack-start",
      "@bgub/fig-tanstack-router",
    ]);

    plugin.configResolved({
      environments: { client: { build: {} }, ssr: { build: {} } },
      resolve: {
        alias: [
          { find: "#tanstack-router-entry", replacement: "/app/router.ts" },
          { find: "#tanstack-start-entry", replacement: "/app/start.ts" },
        ],
      },
      root: "/app",
    });
    const [optimizer] = config?.optimizeDeps?.rolldownOptions?.plugins ?? [];
    expect(optimizer?.resolveId("#tanstack-router-entry")).toEqual({
      external: true,
      id: "/@fs/app/router.ts",
    });
    expect(optimizer?.resolveId("#tanstack-start-entry")).toEqual({
      external: true,
      id: "/@fs/app/start.ts",
    });
  });

  it("emits server-only assets for public delivery", () => {
    const config = compatibilityPlugin().configEnvironment("ssr", {});

    expect(config?.build?.emitAssets).toBe(true);
  });

  it("keeps compiler RPC modules private to the compatibility plugin", () => {
    const plugin = compatibilityPlugin();
    const id = plugin.resolveId("@tanstack/solid-start/client-rpc");

    expect(id).toBe("\0fig-tanstack-start:client-rpc");
    expect(plugin.load(id!)).toMatch(/start-client-core.*client-rpc/);
  });
});

function compatibilityPlugin(): CompatibilityPlugin {
  return tanstackStart()[0] as unknown as CompatibilityPlugin;
}
