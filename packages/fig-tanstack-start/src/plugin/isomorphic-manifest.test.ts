import { describe, expect, it } from "vitest";
import {
  isomorphicReferenceId,
  payloadManifestDefinitionCode,
  payloadManifestRuntimeCode,
  payloadReferenceIds,
} from "./isomorphic-manifest.ts";
import { isServerComponentModuleId } from "./module-ids.ts";

describe("TanStack Start Payload manifest", () => {
  it("gives resolved component exports stable application-relative ids", () => {
    expect(
      isomorphicReferenceId(
        "/app",
        "/app/src/components/Counter.tsx?import",
        "Counter",
      ),
    ).toBe("/src/components/Counter.tsx#Counter");
  });

  it("classifies server components from resolved module ids", () => {
    expect(isServerComponentModuleId("/app/src/nested.server.tsx?import")).toBe(
      true,
    );
    expect(isServerComponentModuleId("/app/src/nested.server.ts")).toBe(true);
    expect(isServerComponentModuleId("/app/src/nested.tsx")).toBe(false);
  });

  it("generates tagged component loaders and development stylesheets", () => {
    const code = payloadManifestDefinitionCode([
      {
        importedName: "Counter",
        localName: "Counter",
        referenceId: "/src/Counter.tsx#Counter",
        resolvedModuleId: "/app/src/Counter.tsx",
        source: "./Counter.tsx",
        developmentStylesheetHrefs: ["/src/counter.css"],
      },
    ]);

    expect(code).toContain(
      "fig-payload-reference=L3NyYy9Db3VudGVyLnRzeCNDb3VudGVy",
    );
    expect(code).toContain('module["Counter"]');
    expect(code).toContain('stylesheets: ["/src/counter.css"]');
  });

  it("derives reference assets from explicit chunk query tags", () => {
    expect(
      payloadReferenceIds([
        "/app/src/Counter.tsx?fig-payload-reference=L3NyYy9Db3VudGVyLnRzeCNDb3VudGVy",
        "/app/src/helper.ts",
      ]),
    ).toEqual(["/src/Counter.tsx#Counter"]);
  });

  it("generates a per-bundle resolver with production asset metadata", () => {
    const code = payloadManifestRuntimeCode(
      new Map([["/src/Counter.tsx#Counter", ["/assets/counter-hash.css"]]]),
    );

    expect(code).toContain("import.meta.glob");
    expect(code).toContain("createPayloadClientReferenceResolver");
    expect(code).toContain("/assets/counter-hash.css");
    expect(code).not.toContain("globalThis");
  });
});
