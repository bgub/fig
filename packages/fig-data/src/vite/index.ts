import {
  assertNoServerDataResourceImport,
  discoverServerDataResources,
  transformServerDataClientStub,
} from "./transform.ts";

export interface FigDataPlugin {
  configResolved(config: { root?: string }): void;
  enforce: "pre";
  name: string;
  transform(
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ): Promise<{ code: string; map: unknown } | null>;
}

export interface FigDataPluginOptions {
  target?: "auto" | "client" | "server";
}

export function figData(options: FigDataPluginOptions = {}): FigDataPlugin {
  let root = process.cwd();
  const target = options.target ?? "auto";

  return {
    name: "fig-data",
    enforce: "pre",
    configResolved(config) {
      if (typeof config.root === "string") root = config.root;
    },
    async transform(code, id, options) {
      const clean = id.split("?")[0] ?? id;
      if (clean.startsWith("\0") || clean.includes("/node_modules/")) {
        return null;
      }

      if (!isServerModuleId(clean)) {
        if (code.includes("@bgub/fig-data/server")) {
          await assertNoServerDataResourceImport(code, clean);
        }
        return null;
      }

      if (transformTarget(target, options) === "client") {
        const result = await transformServerDataClientStub(code, clean, root);
        return { code: result.code, map: result.map };
      }

      if (!code.includes("serverDataResource")) return null;
      await discoverServerDataResources(code, clean, root);
      return null;
    },
  };
}

function transformTarget(
  target: "auto" | "client" | "server",
  options: { ssr?: boolean } | undefined,
): "client" | "server" {
  if (target !== "auto") return target;
  return options?.ssr === true ? "server" : "client";
}

function isServerModuleId(id: string): boolean {
  return id.endsWith(".server.ts") || id.endsWith(".server.tsx");
}

export type {
  ClientDataResourceStub,
  ServerDataClientStubResult,
  ServerDataResourceRef,
} from "./transform.ts";
export {
  assertNoServerDataResourceImport,
  collectServerDataResourceStubs,
  dataResourceId,
  discoverServerDataResources,
  rootRelative,
  transformServerDataClientStub,
} from "./transform.ts";
