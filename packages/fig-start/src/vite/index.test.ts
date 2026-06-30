import { describe, expect, it } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { figStart } from "./index.ts";

describe("@bgub/fig-start/vite plugin", () => {
  it("serves generated client and server entries", async () => {
    const plugin = figStart();
    const clientId = plugin.resolveId("virtual:fig-start/client-entry");
    const serverId = plugin.resolveId("virtual:fig-start/server-entry");

    expect(clientId).toBe("\0virtual:fig-start/client-entry");
    expect(serverId).toBe("\0virtual:fig-start/server-entry");
    await expect(plugin.load(clientId ?? "")).resolves.toBe(
      `import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { start } from "/src/start.tsx";

hydrateStart({
  context: { appName: start.appName },
  loadClientReference,
  onRecoverableError: start.onRecoverableError,
  routes: start.routes,
});
`,
    );
    await expect(plugin.load(serverId ?? "")).resolves.toBe(
      `import { startServer } from "@bgub/fig-start/server";
import { resolveClientReferenceAssets } from "virtual:fig-start/server-manifest";
import { start } from "/src/start.tsx";

const { appName, onRecoverableError, ...serverOptions } = start;

function clientReferenceAssets(metadata) {
  const generated = resolveClientReferenceAssets(metadata);
  const app = serverOptions.clientReferenceAssets?.(metadata);
  if (app === undefined) return generated;
  return Array.isArray(app) ? [...generated, ...app] : [...generated, app];
}

startServer({
  ...serverOptions,
  appUrl: import.meta.url,
  clientReferenceAssets,
  context: () => ({ appName }),
});
`,
    );
  });

  it("resolves root-relative imports from generated virtual modules", () => {
    const plugin = figStart();
    plugin.configResolved({ root: "/project" });

    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/client-entry"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/server-entry"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId(
        "/src/start.tsx",
        "\0virtual:fig-start/server-manifest",
      ),
    ).toBe("/project/src/start.tsx");
  });

  it("loads raw files as string modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-vite-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "styles.css"), ".app { color: red; }");

    const plugin = figStart();
    plugin.configResolved({ root });
    const id = plugin.resolveId("./styles.css?raw", join(root, "src/start.tsx"));

    try {
      expect(id).toBe(`${join(root, "src", "styles.css")}?raw`);
      await expect(plugin.load(id ?? "")).resolves.toBe(
        `export default ${JSON.stringify(".app { color: red; }")};\n`,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("serves a server manifest that resolves client-reference assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-vite-"));
    await mkdir(join(root, "src", "routes"), { recursive: true });
    await writeFile(
      join(root, "src", "routes", "dashboard.server.tsx"),
      `import { Island } from "./Island.tsx";
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
      expect(code).toContain('css: []');
      expect(code).toContain('module: "/src/routes/Island.tsx"');
      expect(code).toContain('readFileSync(new URL("./fig-start-client-assets.json"');
      expect(code).toContain("const built = readClientAssetManifest()");
      expect(code).toContain("modulepreload(module)");
      expect(code).toContain("stylesheet(href)");
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
      `import { Island } from "./Island.tsx";
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

    const plugin = figStart({ target: "client" });
    plugin.configResolved({ root });

    try {
      await plugin.writeBundle?.(
        { dir: join(root, "dist") },
        {
          "Island-abc.js": {
            fileName: "Island-abc.js",
            moduleIds: [join(root, "src", "routes", "Island.tsx")],
            type: "chunk",
          },
          "style-def.css": {
            fileName: "style-def.css",
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
        "/src/routes/Island.tsx#Island": {
          css: ["/style-def.css"],
          module: "/Island-abc.js",
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
