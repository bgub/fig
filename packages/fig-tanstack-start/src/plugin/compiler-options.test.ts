import { describe, expect, it } from "vitest";
import { transformWithBabel } from "./compiler-options.ts";
import {
  type IsomorphicImport,
  isomorphicBoundaryAnalysisPlugin,
} from "./isomorphic-compiler.ts";
import { stylesheetImportAnalysisPlugin } from "./payload-stylesheet-compiler.ts";

describe("Babel analysis", () => {
  it("collects typed JSX boundaries and stylesheets without generating code", async () => {
    const imports: IsomorphicImport[] = [];
    const stylesheets: string[] = [];
    const result = await transformWithBabel(
      `
        import { Isomorphic as Boundary } from "@bgub/fig-tanstack-start/payload";
        import Counter from "./Counter.tsx";
        import "./page.css";
        export function Page(): unknown {
          return <Boundary component={Counter} />;
        }
      `,
      "/app/page.tsx",
      {
        code: false,
        plugins: [
          isomorphicBoundaryAnalysisPlugin(imports),
          stylesheetImportAnalysisPlugin(stylesheets),
        ],
      },
    );

    expect(imports).toEqual([
      {
        importedName: "default",
        localName: "Counter",
        source: "./Counter.tsx",
      },
    ]);
    expect(stylesheets).toEqual(["./page.css"]);
    expect(result?.code).toBeNull();
    expect(result?.map).toBeNull();
  });
});
