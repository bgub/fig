import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Alias, EnvironmentOptions, UserConfig } from "vite";
import {
  createCompilerRpcModules,
  createDefaultServerEntry,
  incompatibleRuntimeModules,
  rewriteFrameworkImports,
  tanStackCompatibilityProfile,
} from "./compatibility-profile.ts";
import { writePublicAsset } from "./public-assets.ts";
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
}

interface PayloadPlugin {
  configEnvironment(
    environmentName: string,
    environment: EnvironmentOptions,
  ): { build?: EnvironmentOptions["build"] } | undefined;
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

  it("keeps compatibility and Payload build concerns in separate plugins", () => {
    expect(tanstackStart().slice(0, 2)).toEqual([
      expect.objectContaining({ name: "fig-tanstack-start:compatibility" }),
      expect.objectContaining({ name: "fig-tanstack-start:payload" }),
    ]);
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

  it("pins the compatibility profile to the installed Start core contract", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(tanStackCompatibilityProfile.versions).toEqual({
      routerCore: packageJson.dependencies["@tanstack/router-core"],
      startClientCore: packageJson.dependencies["@tanstack/start-client-core"],
      startPluginCore: packageJson.dependencies["@tanstack/start-plugin-core"],
      startServerCore: packageJson.dependencies["@tanstack/start-server-core"],
    });
  });

  it("rewrites generated Start imports without admitting Solid runtime modules", () => {
    const transformed = rewriteFrameworkImports(
      'import { createServerFn } from "@bgub/fig-tanstack-start";',
    );
    const solidModule =
      "/app/node_modules/@tanstack/solid-start/dist/client.js";

    expect(transformed).toContain('from "@tanstack/solid-start"');
    expect(incompatibleRuntimeModules([solidModule])).toEqual([solidModule]);
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
    const config = payloadPlugin().configEnvironment("ssr", {});

    expect(config?.build?.emitAssets).toBe(true);
  });

  it("rejects conflicting server and client assets at one public path", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-assets-"));
    try {
      const assetPath = join(root, "client/assets/shared.css");
      await writePublicAsset(assetPath, "client");

      await expect(
        writePublicAsset(assetPath, "client"),
      ).resolves.toBeUndefined();
      await expect(writePublicAsset(assetPath, "server")).rejects.toThrow(
        /conflicts with a different client asset/,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps compiler RPC modules private to the compatibility plugin", () => {
    const modules = createCompilerRpcModules((id) => `/resolved/${id}`);
    const clientRpc = modules.find(
      (module) => module.source === "@tanstack/solid-start/client-rpc",
    );

    expect(clientRpc).toEqual({
      code: expect.stringMatching(/start-client-core.*client-rpc/),
      id: "\0fig-tanstack-start:client-rpc",
      source: "@tanstack/solid-start/client-rpc",
    });
  });

  it("builds the default handler directly from the public renderer", () => {
    const code = createDefaultServerEntry();

    expect(code).toContain("createStartHandler(renderRouterToStream)");
    expect(code).not.toContain("defaultStreamHandler");
  });
});

function compatibilityPlugin(): CompatibilityPlugin {
  return tanstackStart()[0] as unknown as CompatibilityPlugin;
}

function payloadPlugin(): PayloadPlugin {
  return tanstackStart()[1] as unknown as PayloadPlugin;
}
