import { expect, test } from "@playwright/test";
import { build } from "vite";
import {
  figSourceResolveAliases,
  workspacePath,
} from "../../../scripts/lib/fig-source-aliases.ts";

const scripts = new Map<string, string>();
let entry: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "error",
    resolve: { alias: figSourceResolveAliases() },
    define: { __FIG_DEV__: "true" },
    build: {
      write: false,
      target: "esnext",
      lib: {
        entry: workspacePath("packages/fig-dom/e2e/form-fixture.ts"),
        formats: ["es"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!("output" in output)) continue;
    for (const chunk of output.output) {
      if (chunk.type !== "chunk") continue;
      scripts.set("/" + chunk.fileName, chunk.code);
      if (chunk.isEntry) entry = chunk.fileName;
    }
  }
});

test.beforeEach(async ({ page }) => {
  await page.route("http://hydration.test/**", (route) => {
    const script = scripts.get(new URL(route.request().url()).pathname);
    return route.fulfill({
      contentType: script === undefined ? "text/html" : "text/javascript",
      body:
        script ??
        `<div id="form"></div><button id="hydrate">Hydrate</button><script type="module" src="/${entry}"></script>`,
    });
  });
});

for (const uncontrolled of [false, true]) {
  test(`preserves pre-hydration edits through an immediate render (uncontrolled=${uncontrolled})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(
      `http://hydration.test/${uncontrolled ? "?uncontrolled" : ""}`,
    );
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.locator("#text").fill("User typed");
    await page.locator("#notes").fill("User notes");
    await page.locator("#checked").check();
    await page.locator("#radio-b").check();
    await page.locator("#single").selectOption("b");
    await page.locator("#multiple").selectOption(["b", "c"]);
    await page.getByRole("button", { name: "Hydrate" }).click();
    await expect(page.locator("#form > div")).toHaveAttribute("data-tick", "1");
    await expect(page.locator("#text")).toHaveValue("User typed");
    await expect(page.locator("#notes")).toHaveValue("User notes");
    await expect(page.locator("#checked")).toBeChecked();
    await expect(page.locator("#radio-a")).not.toBeChecked();
    await expect(page.locator("#radio-b")).toBeChecked();
    await expect(page.locator("#single")).toHaveValue("b");
    await expect(page.locator("#multiple")).toHaveValues(["b", "c"]);
    if (!uncontrolled)
      await expect(page.locator("#state")).toHaveText(
        JSON.stringify({
          text: "User typed",
          notes: "User notes",
          checked: true,
          choice: "b",
          single: "b",
          multiple: ["b", "c"],
        }),
      );
    expect(errors).toEqual([]);
  });
}

test("coalesces native input/change following a click that hydrates a checkbox", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    (document.getElementById("checked") as HTMLInputElement).click();
  });
  await expect(page.locator("#checked")).toBeChecked();
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "1");
  await page.locator("#checked").uncheck();
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "2");
});

test("coalesces activation events when a replay handler rejects the checkbox edit", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation&reject");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    (document.getElementById("checked") as HTMLInputElement).click();
  });
  await expect(page.locator("#checked")).not.toBeChecked();
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "1");
});

test("delivers a later activation after a cancelled hydration click in the same task", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation&cancel");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    const checkbox = document.getElementById("checked") as HTMLInputElement;
    checkbox.click();
    checkbox.click();
  });
  await expect(page.locator("#checked")).toBeChecked();
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "2");
});

test("delivers an activation nested inside a hydration notification", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation&nested");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    (document.getElementById("checked") as HTMLInputElement).click();
  });
  await expect(page.locator("#checked")).not.toBeChecked();
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "2");
});
