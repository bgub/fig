import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enrichManifestReferences,
  resolvePayloadReferences,
} from "./payload-references.ts";

const page = `
  import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
  import { Counter } from "./Counter.tsx";
  export function Page() { return <Isomorphic component={Counter} />; }
`;

describe("Payload reference phases", () => {
  it("resolves component identities without reading their stylesheet sources", async () => {
    const imports: string[] = [];
    const references = await resolvePayloadReferences(
      "/app/page.tsx?fig-payload-module=1",
      page,
      async (source, importer) => {
        imports.push(`${importer}:${source}`);
        return { id: "/app/Counter.tsx?import" };
      },
      "/app",
    );

    expect(imports).toEqual(["/app/page.tsx:./Counter.tsx"]);
    expect(references).toEqual([
      {
        importedName: "Counter",
        localName: "Counter",
        source: "./Counter.tsx",
        referenceId: "/Counter.tsx#Counter",
        resolvedModuleId: "/app/Counter.tsx",
      },
    ]);
  });

  it("enriches manifest references with stylesheet URLs and HMR source fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-payload-references-"));
    try {
      const component = join(root, "Counter.tsx");
      await writeFile(
        component,
        'import "./counter.css"; import "./missing.css";',
      );
      const references = await resolvePayloadReferences(
        join(root, "page.tsx"),
        page,
        async () => ({ id: component }),
        root,
      );
      const result = await enrichManifestReferences(
        references,
        root,
        async (source) =>
          source === "./counter.css"
            ? { id: `${join(root, "counter.css")}?import` }
            : null,
      );

      expect(result.references).toEqual([
        { ...references[0], developmentStylesheetHrefs: ["/counter.css"] },
      ]);
      expect(result.stylesheetSources.get(component)).toBe(
        JSON.stringify(["./counter.css", "./missing.css"]),
      );
      expect(references[0]).not.toHaveProperty("developmentStylesheetHrefs");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves missing component resolution diagnostics", async () => {
    await expect(
      resolvePayloadReferences("/app/page.tsx", page, async () => null, "/app"),
    ).rejects.toThrow(
      'Cannot resolve Isomorphic component import "./Counter.tsx" from /app/page.tsx.',
    );
  });
});
