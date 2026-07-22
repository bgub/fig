import { describe, expect, it } from "vitest";
import {
  analyzeIsomorphicBoundaries,
  payloadRuntimeCode,
  payloadRuntimeId,
  transformPayloadModule,
} from "./payload-compiler.ts";

describe("TanStack Start Payload compiler", () => {
  it("attaches imported stylesheets to named components in ordinary modules", async () => {
    const result = await transformPayloadModule(
      `
        import "./card.css";
        import styles from "./theme.module.css";

        export function Card(): unknown {
          return <section class={styles.card}>Card</section>;
        }

        function helper(): void {}
      `,
      "/app/card.tsx?fig-payload-module=1",
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

  it("leaves asset-free modules unchanged", async () => {
    await expect(
      transformPayloadModule(
        `export function Card() { return null }`,
        "/app/card.server.tsx",
      ),
    ).resolves.toBeNull();
    // Payload-marked modules with nothing to rewrite also stay untouched
    // instead of returning babel-regenerated code.
    await expect(
      transformPayloadModule(
        `export function Card() { return null }`,
        "/app/card.tsx?fig-payload-module=1",
      ),
    ).resolves.toBeNull();
  });

  it("generates the private component annotation runtime", () => {
    expect(payloadRuntimeCode()).toMatch(
      /Symbol\.for\("fig\.tanstack-start\.payload-stylesheets"\)/,
    );
    expect(payloadRuntimeCode()).toContain("Object.defineProperty(component");
  });

  it("compiles only explicit Isomorphic component props into references", async () => {
    const code = `
      import { Isomorphic as Hydrate } from "@bgub/fig-tanstack-start/payload";
      import { Suspense } from "@bgub/fig";
      import { helper, Island as RenamedIsland } from "./Island.tsx";
      import { Nested } from "./nested.tsx";

      export function Card() {
        helper();
        return (
          <Suspense>
            <Nested />
            <Hydrate component={RenamedIsland} initial={3} />
          </Suspense>
        );
      }
    `;
    await expect(
      analyzeIsomorphicBoundaries(code, "/app/card.tsx"),
    ).resolves.toEqual([
      {
        importedName: "Island",
        localName: "RenamedIsland",
        source: "./Island.tsx",
      },
    ]);

    const result = await transformPayloadModule(
      code,
      "/app/card.tsx?fig-payload-module=1",
      [
        {
          importedName: "Island",
          localName: "RenamedIsland",
          referenceId: "/src/Island.tsx#Island",
          source: "./Island.tsx",
        },
      ],
    );

    expect(result?.code).toContain(
      'component={_createIsomorphicReference("/src/Island.tsx#Island")}',
    );
    expect(result?.code).toContain('import { helper } from "./Island.tsx"');
    expect(result?.code).toContain(
      'import { Nested } from "./nested.tsx?fig-payload-module=1"',
    );
  });

  it("preserves an imported component that also renders through Payload", async () => {
    const code = `
      import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
      import { Island } from "./Island.tsx";

      export function Card() {
        return <><Island /><Isomorphic component={Island} /></>;
      }
    `;
    const result = await transformPayloadModule(
      code,
      "/app/card.tsx?fig-payload-module=1",
      [
        {
          importedName: "Island",
          localName: "Island",
          referenceId: "/src/Island.tsx#Island",
          source: "./Island.tsx",
        },
      ],
    );

    expect(result?.code).toContain(
      'import { Island } from "./Island.tsx?fig-payload-module=1"',
    );
  });

  it("starts Payload compilation at renderPayloadResponse", async () => {
    const result = await transformPayloadModule(
      `
        import { renderPayloadResponse as renderPayload } from "@bgub/fig-tanstack-start/server";
        import { Profile } from "./Profile.tsx";

        export function response() {
          return renderPayload(<Profile id="ada" />);
        }
      `,
      "/app/profile-payload.tsx",
    );

    expect(result?.code).toContain(
      'import { Profile } from "./Profile.tsx?fig-payload-module=1"',
    );
  });

  it("compiles similarly named application packages without compiling Fig runtimes", async () => {
    const result = await transformPayloadModule(
      `
        import { Suspense } from "@bgub/fig";
        import { Panel } from "@bgub/fig-ui";

        export function Card() {
          return <Suspense><Panel /></Suspense>;
        }
      `,
      "/app/card.tsx?fig-payload-module=1",
    );

    expect(result?.code).toContain('from "@bgub/fig"');
    expect(result?.code).not.toContain('from "@bgub/fig?fig-payload-module=1"');
    expect(result?.code).toContain('from "@bgub/fig-ui?fig-payload-module=1"');
  });

  it("rejects non-imported Isomorphic components", async () => {
    await expect(
      analyzeIsomorphicBoundaries(
        `
          import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
          function Island() { return null; }
          export function Card() { return <Isomorphic component={Island} />; }
        `,
        "/app/card.tsx",
      ),
    ).rejects.toThrow(/statically imported component identifier/);
  });

  it("supports a statically imported default Isomorphic component", async () => {
    await expect(
      analyzeIsomorphicBoundaries(
        `
          import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
          import Island from "./Island.tsx";
          export function Card() { return <Isomorphic component={Island} />; }
        `,
        "/app/card.tsx",
      ),
    ).resolves.toEqual([
      {
        importedName: "default",
        localName: "Island",
        source: "./Island.tsx",
      },
    ]);
  });
});
