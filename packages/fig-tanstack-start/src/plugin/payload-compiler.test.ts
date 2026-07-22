import { describe, expect, it } from "vitest";
import {
  analyzePayloadModule,
  payloadRuntimeCode,
  payloadRuntimeId,
  transformPayloadModule,
} from "./payload-compiler.ts";

describe("TanStack Start Payload asset compiler", () => {
  it("attaches imported stylesheets to named server components", async () => {
    const result = await transformPayloadModule(
      `
        import "./card.css";
        import styles from "./theme.module.css";

        export function Card(): unknown {
          return <section class={styles.card}>Card</section>;
        }

        function helper(): void {}
      `,
      "/app/card.server.tsx",
    );

    expect(result?.code).toContain(payloadRuntimeId);
    expect(result?.code).toMatch(
      /import _figPayloadStylesheet\d* from "\.\/card\.css\?url"/,
    );
    expect(result?.code).toMatch(
      /import _figPayloadStylesheet\d* from "\.\/theme\.module\.css\?url"/,
    );
    expect(result?.code).toMatch(
      /_registerPayloadStylesheets\d*\(\[Card\], \[_figPayloadStylesheet/,
    );
    expect(result?.code).not.toMatch(/\[Card, helper\]/);
  });

  it("leaves ordinary and asset-free modules unchanged", async () => {
    await expect(
      transformPayloadModule(
        `export function Card() { return null }`,
        "/app/card.tsx",
      ),
    ).resolves.toBeNull();
    await expect(
      transformPayloadModule(
        `export function Card() { return null }`,
        "/app/card.server.tsx",
      ),
    ).resolves.toBeNull();
  });

  it("generates the private component annotation runtime", () => {
    expect(payloadRuntimeCode()).toMatch(
      /Symbol\.for\("fig\.tanstack-start\.payload-stylesheets"\)/,
    );
    expect(payloadRuntimeCode()).toContain("Object.defineProperty(component");
  });

  it("replaces ordinary imported components with compiled references", async () => {
    const code = `
      import { Suspense } from "@bgub/fig";
      import { helper, Island as RenamedIsland } from "./Island.tsx";
      import { Nested } from "./nested.server.tsx";

      export function Card() {
        helper();
        return <Suspense><RenamedIsland /><Nested /></Suspense>;
      }
    `;
    await expect(
      analyzePayloadModule(code, "/app/card.server.tsx"),
    ).resolves.toEqual([
      {
        importedName: "Island",
        localName: "RenamedIsland",
        source: "./Island.tsx",
      },
      {
        importedName: "Nested",
        localName: "Nested",
        source: "./nested.server.tsx",
      },
    ]);

    const result = await transformPayloadModule(code, "/app/card.server.tsx", [
      {
        importedName: "Island",
        localName: "RenamedIsland",
        referenceId: "/src/Island.tsx#Island",
        source: "./Island.tsx",
      },
    ]);

    expect(result?.code).toContain(
      'const RenamedIsland = _createIsomorphicReference("/src/Island.tsx#Island")',
    );
    expect(result?.code).toContain('import { helper } from "./Island.tsx"');
    expect(result?.code).toContain(
      'import { Nested } from "./nested.server.tsx"',
    );
  });
});
