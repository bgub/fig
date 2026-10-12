import { expect, test } from "@playwright/test";
import { build } from "tsdown";
import {
  figSourceAliases,
  workspacePath,
} from "../../scripts/lib/fig-source-aliases.ts";
import { collectBrowserErrors } from "./browser-errors.ts";
import type {} from "./fixtures/host-updates.ts";

for (const development of [true, false]) {
  test.describe(development ? "development" : "production", () => {
    let fixture: string;

    test.beforeAll(async () => {
      const [bundle] = await build({
        config: false,
        entry: [workspacePath("tests/browser/fixtures/host-updates.ts")],
        alias: figSourceAliases(),
        define: { __FIG_DEV__: String(development) },
        deps: { alwaysBundle: [/^@bgub\/fig/] },
        format: "iife",
        platform: "browser",
        dts: false,
        write: false,
        clean: false,
        logLevel: "silent",
      });
      try {
        expect(bundle.chunks).toHaveLength(1);
        const chunk = bundle.chunks[0];
        if (chunk.type !== "chunk")
          throw new Error("Expected a JavaScript fixture bundle.");
        fixture = chunk.code;
      } finally {
        await bundle[Symbol.asyncDispose]();
      }
    });

    test("releasing select control preserves selection when an option value changes", async ({
      page,
    }) => {
      const errors = collectBrowserErrors(page);
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: fixture });
      await page.evaluate(() => window.hostUpdateFixture.render(true));
      const select = page.locator("select");
      await expect(select).toHaveValues(["b"]);
      await expect(select).toHaveJSProperty("selectedIndex", 1);

      // The select must retire its old controlled value before its option
      // updates; otherwise that option is deselected against the stale value.
      await page.evaluate(() => window.hostUpdateFixture.render(false));
      await expect(select).toHaveValues(["c"]);
      await expect(select).toHaveJSProperty("selectedIndex", 1);
      expect(errors()).toEqual([]);
    });
  });
}
