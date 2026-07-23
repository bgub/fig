import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  resolveId(
    this: PayloadPluginContext,
    source: string,
    importer?: string,
  ): Promise<string | null | undefined>;
  load(this: PayloadPluginContext, id: string): Promise<string | undefined>;
  hotUpdate(
    this: {
      environment: {
        moduleGraph: {
          getModuleById(id: string): { id: string } | undefined;
        };
      };
    },
    options: { file: string; modules: unknown[]; read(): Promise<string> },
  ): Promise<unknown[] | undefined>;
}

interface PayloadPluginContext {
  addWatchFile(id: string): void;
  resolve(
    source: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<{ id: string } | null>;
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

  it("keeps compatibility and Payload compilation concerns in separate plugins", () => {
    expect(tanstackStart().slice(0, 3)).toEqual([
      expect.objectContaining({ name: "fig-tanstack-start:compatibility" }),
      expect.objectContaining({
        name: "fig-tanstack-start:server-payload",
      }),
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

  it("reloads manifest definitions only when Isomorphic boundaries change", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-hotupdate-"));
    try {
      const labPath = join(root, "lab.tsx");
      const plainPath = join(root, "plain.tsx");
      const islandPath = join(root, "Island.tsx");
      const boundaryCode = `
        import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
        import { Island } from "./Island.tsx";
        export function Lab() {
          return <Isomorphic component={Island} />;
        }
      `;
      await writeFile(
        islandPath,
        "export function Island() { return null; }\n",
      );
      await writeFile(labPath, boundaryCode);
      await writeFile(plainPath, "export const plain = true;\n");

      const plugin = payloadPlugin();
      const context: PayloadPluginContext = {
        addWatchFile: () => undefined,
        resolve: (source) =>
          Promise.resolve({
            id: source.startsWith("./") ? join(root, source.slice(2)) : source,
          }),
      };
      const definitions = new Map<string, { id: string }>();
      for (const file of [labPath, plainPath]) {
        const definitionId = await plugin.resolveId.call(
          context,
          `${file}?fig-payload-manifest`,
          file,
        );
        if (typeof definitionId !== "string") {
          throw new Error("Expected a manifest definition id.");
        }
        await plugin.load.call(context, definitionId);
        definitions.set(file, { id: definitionId });
      }

      const hotUpdate = (file: string, code: string) =>
        plugin.hotUpdate.call(
          {
            environment: {
              moduleGraph: {
                getModuleById: (id) =>
                  [...definitions.values()].find(
                    (definition) => definition.id === id,
                  ),
              },
            },
          },
          { file, modules: [], read: () => Promise.resolve(code) },
        );

      // Unchanged boundaries keep the loaded definition.
      await expect(hotUpdate(labPath, boundaryCode)).resolves.toBeUndefined();
      // Files without a definition module in the graph are untouched.
      await expect(
        hotUpdate(join(root, "unknown.tsx"), boundaryCode),
      ).resolves.toBeUndefined();
      // The first boundary in a boundary-free file reloads its definition.
      await expect(hotUpdate(plainPath, boundaryCode)).resolves.toEqual([
        definitions.get(plainPath),
      ]);
      // Removing every boundary reloads the definition too.
      await expect(
        hotUpdate(labPath, "export function Lab() { return null; }"),
      ).resolves.toEqual([definitions.get(labPath)]);
      // Ordinary edits to a referenced component keep its dependents.
      await expect(
        hotUpdate(islandPath, "export function Island() { return <p />; }"),
      ).resolves.toBeUndefined();
      // A stylesheet-import change in a referenced component reloads the
      // definitions that embed its development hrefs.
      await expect(
        hotUpdate(
          islandPath,
          'import "./island.css";\nexport function Island() { return null; }',
        ),
      ).resolves.toEqual([definitions.get(labPath)]);
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
  return tanstackStart()[2] as unknown as PayloadPlugin;
}
