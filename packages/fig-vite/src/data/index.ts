import {
  assertNoServerDataResourceImport,
  transformServerDataClientStub,
} from "./transform.ts";

export interface FigDataPlugin {
  enforce: "pre";
  name: string;
  transform(
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ): Promise<{ code: string; map: unknown } | null>;
}

export function figData(): FigDataPlugin {
  return {
    name: "fig-data",
    enforce: "pre",
    async transform(code, id, options) {
      const clean = id.split("?")[0] ?? id;
      if (clean.startsWith("\0") || clean.includes("/node_modules/")) {
        return null;
      }

      if (!isServerModuleId(clean)) {
        if (code.includes("@bgub/fig/server")) {
          await assertNoServerDataResourceImport(code, clean);
        }
        return null;
      }

      if (options?.ssr === true) return null;
      return transformServerDataClientStub(code, clean);
    },
  };
}

function isServerModuleId(id: string): boolean {
  return id.endsWith(".server.ts") || id.endsWith(".server.tsx");
}
