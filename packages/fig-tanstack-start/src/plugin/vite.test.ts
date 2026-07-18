import { describe, expect, it } from "vitest";
import type { Alias, EnvironmentOptions, UserConfig } from "vite";
import { tanstackStart } from "./vite.ts";

interface CompatibilityPlugin {
  config(): UserConfig;
  configEnvironment(
    environmentName: string,
    environment: EnvironmentOptions,
  ): EnvironmentOptions | undefined;
  load(id: string): string | undefined;
  resolveId(source: string): string | undefined;
}

describe("tanstackStart", () => {
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

  it("keeps virtual Start entries out of client dependency optimization", () => {
    const config = compatibilityPlugin().configEnvironment("client", {
      optimizeDeps: { exclude: ["existing"] },
    });

    expect(config?.optimizeDeps?.exclude).toEqual([
      "existing",
      "@bgub/fig-tanstack-start",
      "@bgub/fig-tanstack-router",
      "@tanstack/start-client-core",
    ]);
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
