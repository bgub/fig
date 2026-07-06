import { describe, expect, it } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { figStart } from "./index.ts";
import {
  CLIENT_ENTRY_ID,
  CLIENT_RUNTIME_ID,
  resolvedVirtualId,
} from "./ids.ts";

describe("@bgub/fig-start/vite plugin", () => {
  it("serves generated client and server entries", async () => {
    const plugin = figStart();
    const clientId = plugin.resolveId("virtual:fig-start/client-entry");
    const runtimeId = plugin.resolveId("virtual:fig-start/client-runtime");
    const serverId = plugin.resolveId("virtual:fig-start/server-entry");

    expect(clientId).toBe("\0virtual:fig-start/client-entry");
    expect(runtimeId).toBe("\0virtual:fig-start/client-runtime");
    expect(serverId).toBe("\0virtual:fig-start/server-entry");
    await expect(plugin.load(clientId ?? "")).resolves.toBe(
      `import { startFigStartClient } from "virtual:fig-start/client-runtime";

startFigStartClient();
`,
    );
    await expect(plugin.load(runtimeId ?? "")).resolves.toBe(
      `import "virtual:fig-start/server-route-assets";
import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { start } from "/src/start.tsx";

export function startFigStartClient() {
  hydrateStart({
    context: { appName: start.appName },
    loadClientReference,
    onRecoverableError: start.onRecoverableError,
    routes: start.routes,
  });
}
`,
    );
    await expect(plugin.load(serverId ?? "")).resolves.toBe(
      `import { startServer } from "@bgub/fig-start/server";
import { resolveClientReferenceAssets, resolveServerRouteAssets } from "virtual:fig-start/server-manifest";
import { serverDataResources } from "virtual:fig-start/server-data-resources";
import { start } from "/src/start.tsx";

const { appName, onRecoverableError, ...serverOptions } = start;

function clientReferenceAssets(metadata) {
  const generated = resolveClientReferenceAssets(metadata);
  const app = serverOptions.clientReferenceAssets?.(metadata);
  if (app === undefined) return generated;
  return Array.isArray(app) ? [...generated, ...app] : [...generated, app];
}

function serverRouteAssets(metadata) {
  const generated = resolveServerRouteAssets(metadata);
  const app = serverOptions.serverRouteAssets?.(metadata);
  if (app === undefined) return generated;
  return Array.isArray(app) ? [...generated, ...app] : [...generated, app];
}

startServer({
  ...serverOptions,
  appUrl: import.meta.url,
  clientReferenceAssets,
  context: () => ({ appName }),
  serverDataResources,
  serverRouteAssets,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
`,
    );
  });

  it("can inject a browser NODE_ENV shim into the generated client entry", async () => {
    const plugin = figStart({ clientNodeEnv: "development" });
    const clientId = plugin.resolveId("virtual:fig-start/client-entry");
    const devEnvId = plugin.resolveId("virtual:fig-start/dev-env");

    expect(clientId).toBe("\0virtual:fig-start/client-entry");
    expect(devEnvId).toBe("\0virtual:fig-start/dev-env");
    await expect(plugin.load(clientId ?? "")).resolves.toContain(
      'import "virtual:fig-start/dev-env";\nimport { startFigStartClient } from "virtual:fig-start/client-runtime";',
    );
    await expect(plugin.load(devEnvId ?? "")).resolves.toBe(
      `globalThis.process ??= { env: {} };
globalThis.process.env ??= {};
globalThis.process.env.NODE_ENV ??= "development";
export {};
`,
    );
  });

  it("rejects server data resource imports outside server modules", async () => {
    const plugin = figStart();

    await expect(
      plugin.transform(
        `import { serverDataResource } from "@bgub/fig/server";
export const user = serverDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
        "/project/src/user.ts",
      ),
    ).rejects.toThrow(/serverDataResource may only be imported/);
  });

  it("resolves root-relative imports from generated virtual modules", () => {
    const plugin = figStart();
    plugin.configResolved({ root: "/project" });

    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/client-entry"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/client-runtime"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/server-entry"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/server-manifest"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId(
        "/src/start.tsx",
        "\0virtual:fig-start/server-data-resources",
      ),
    ).toBe("/project/src/start.tsx");
  });

  it("adds the client runtime entry to Fig Start client pack builds", () => {
    const plugin = figStart({ target: "client" });
    const config = {
      entry: { client: CLIENT_ENTRY_ID },
    };

    plugin.tsdownConfig?.(config);

    expect(config.entry).toEqual({
      client: CLIENT_ENTRY_ID,
      "fig-start-client-runtime": CLIENT_RUNTIME_ID,
    });
  });

  it("does not add the client runtime entry to server pack builds", () => {
    const plugin = figStart({ target: "server" });
    const config = {
      entry: { server: "virtual:fig-start/server-entry" },
    };

    plugin.tsdownConfig?.(config);

    expect(config.entry).toEqual({
      server: "virtual:fig-start/server-entry",
    });
  });

  it("preserves an explicit client runtime pack entry", () => {
    const plugin = figStart({ target: "client" });
    const config = {
      entry: {
        client: CLIENT_ENTRY_ID,
        runtime: CLIENT_RUNTIME_ID,
      },
    };

    plugin.tsdownConfig?.(config);

    expect(config.entry).toEqual({
      client: CLIENT_ENTRY_ID,
      runtime: CLIENT_RUNTIME_ID,
    });
  });

  it("adds the client runtime entry to Vite client build inputs", () => {
    const plugin = figStart({ target: "client" });
    const config = {
      build: {
        rollupOptions: {
          input: { client: CLIENT_ENTRY_ID },
        },
      },
    };

    plugin.config?.(config);

    expect(config.build.rollupOptions.input).toEqual({
      client: CLIENT_ENTRY_ID,
      "fig-start-client-runtime": CLIENT_RUNTIME_ID,
    });
  });

  it("transforms Tailwind CSS before the CSS bundler sees imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-vite-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "index.tsx"),
      `export function App() {
  return <h1 class="text-3xl font-semibold">Ready</h1>;
}`,
    );

    const plugin = figStart({ tailwind: true });
    plugin.configResolved({ root });

    try {
      const result = await plugin.transform(
        `@import "tailwindcss";\n@source "./";\n`,
        join(root, "src", "styles.css"),
      );

      expect(result?.code).toContain(".text-3xl");
      expect(result?.code).toContain(".font-semibold");
      expect(result?.map).not.toBe(null);
      expect(result?.code).not.toContain("@tailwind");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not transform ordinary CSS when Tailwind support is enabled", async () => {
    const plugin = figStart({ tailwind: true });

    await expect(
      plugin.transform(
        ".root { color: red; }",
        "/project/src/Island.module.css",
      ),
    ).resolves.toBe(null);
  });

  it("serves a server manifest that resolves client-reference assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-vite-"));
    await mkdir(join(root, "src", "routes"), { recursive: true });
    await writeFile(
      join(root, "src", "routes", "dashboard.server.tsx"),
      `import { createFileRoute } from "@bgub/fig-start";
import { Island } from "./Island.tsx";
export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});
export function Dashboard() {
  return <Island />;
}`,
    );
    await writeFile(
      join(root, "src", "routes", "Island.tsx"),
      `import styles from "./Island.module.css";
export function Island() {
  return <button class={styles.root}>Island</button>;
}`,
    );

    const plugin = figStart();
    plugin.configResolved({ root });
    const id = plugin.resolveId("virtual:fig-start/server-manifest");

    try {
      const code = await plugin.load(id ?? "");
      expect(code).toContain('"/src/routes/Island.tsx#Island"');
      expect(code).toContain("const routes = {");
      expect(code).toContain('"/dashboard": { assets: [], css: [] }');
      expect(code).toContain("css: []");
      expect(code).toContain("assets: []");
      expect(code).toContain('module: "/src/routes/Island.tsx"');
      expect(code).toContain(
        'readFileSync(new URL("./fig-start-client-assets.json"',
      );
      expect(code).toContain("readClientAssetManifest().clientReferences");
      expect(code).toContain("readClientAssetManifest().serverRoutes");
      expect(code).toContain("modulepreload(module)");
      expect(code).toContain("stylesheet(href)");
      expect(code).toContain("preload(href");
      expect(code).not.toContain("imports:");
      expect(code).not.toContain("/style.css");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("writes a client build asset manifest from output files", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-vite-"));
    await mkdir(join(root, "src", "routes"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(
      join(root, "src", "routes", "dashboard.server.tsx"),
      `import { createFileRoute } from "@bgub/fig-start";
import { Island } from "./Island.tsx";
import { Other } from "./Other.tsx";
import styles from "./dashboard.module.css";
export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});
export function Dashboard() {
  return <>
    <section class={styles.root}>Dashboard</section>
    <Island />
    <Other />
  </>;
}`,
    );
    await writeFile(
      join(root, "src", "routes", "Island.tsx"),
      `import styles from "./Island.module.css";
import markHref from "./island-mark.svg";
export function Island() {
  return <button class={styles.root}><img src={markHref} />Island</button>;
}`,
    );
    await writeFile(
      join(root, "src", "routes", "Other.tsx"),
      `import styles from "./Other.module.css";
export function Other() {
  return <button class={styles.root}>Other</button>;
}`,
    );
    await writeFile(join(root, "src", "routes", "dashboard.module.css"), "");

    const plugin = figStart({ target: "client" });
    plugin.configResolved({ root });

    try {
      await plugin.writeBundle?.(
        { dir: join(root, "dist") },
        {
          "client.js": {
            fileName: "client.js",
            imports: ["start-abc.js"],
            moduleIds: [resolvedVirtualId(CLIENT_ENTRY_ID)],
            type: "chunk",
          },
          "start-abc.js": {
            fileName: "start-abc.js",
            moduleIds: [join(root, "src", "start.tsx")],
            type: "chunk",
            viteMetadata: {
              importedCss: new Set(["assets/global.css"]),
            },
          },
          "Island-abc.js": {
            fileName: "Island-abc.js",
            moduleIds: [join(root, "src", "routes", "Island.tsx")],
            type: "chunk",
            viteMetadata: {
              importedAssets: new Set(["assets/island-mark.svg"]),
              importedCss: new Set(["assets/island-def.css"]),
            },
          },
          "Other-abc.js": {
            fileName: "Other-abc.js",
            moduleIds: [join(root, "src", "routes", "Other.tsx")],
            type: "chunk",
            viteMetadata: {
              importedCss: new Set(["assets/other-def.css"]),
            },
          },
          "dashboard-assets.js": {
            fileName: "dashboard-assets.js",
            moduleIds: [
              "\0virtual:fig-start/server-route-asset-module:/src/routes/dashboard.server.tsx",
            ],
            type: "chunk",
          },
          "assets/global.css": {
            fileName: "assets/global.css",
            source: "body{}",
            type: "asset",
          },
          "assets/island-def.css": {
            fileName: "assets/island-def.css",
            source: ".root{}",
            type: "asset",
          },
          "assets/island-mark.svg": {
            fileName: "assets/island-mark.svg",
            source: "<svg></svg>",
            type: "asset",
          },
          "assets/other-def.css": {
            fileName: "assets/other-def.css",
            source: ".root{}",
            type: "asset",
          },
          "assets/dashboard-def.css": {
            fileName: "assets/dashboard-def.css",
            source: ".root{}",
            type: "asset",
          },
        },
      );

      const manifest = await readFile(
        join(root, "dist", "fig-start-client-assets.json"),
        "utf8",
      );
      expect(JSON.parse(manifest)).toEqual({
        assets: [
          "/client.js",
          "/start-abc.js",
          "/Island-abc.js",
          "/Other-abc.js",
          "/dashboard-assets.js",
          "/assets/global.css",
          "/assets/island-def.css",
          "/assets/island-mark.svg",
          "/assets/other-def.css",
          "/assets/dashboard-def.css",
        ],
        client: {
          css: ["/assets/global.css"],
          module: "/client.js",
        },
        clientReferences: {
          "/src/routes/Island.tsx#Island": {
            assets: ["/assets/island-mark.svg"],
            css: ["/assets/island-def.css"],
            module: "/Island-abc.js",
          },
          "/src/routes/Other.tsx#Other": {
            css: ["/assets/other-def.css"],
            module: "/Other-abc.js",
          },
        },
        serverRoutes: {
          "/dashboard": {
            css: ["/fig-start/dashboard-PrPYO5FuUW.css"],
          },
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
