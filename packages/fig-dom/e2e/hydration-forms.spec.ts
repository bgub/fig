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

for (const { uncontrolled, adoption } of [
  { uncontrolled: false, adoption: true },
  { uncontrolled: true, adoption: true },
  { uncontrolled: false, adoption: false },
  { uncontrolled: true, adoption: false },
]) {
  test(`respects field ownership through hydration and an immediate render (uncontrolled=${uncontrolled}, adoption=${adoption})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const params = new URLSearchParams();
    if (uncontrolled) params.set("uncontrolled", "");
    if (!adoption) params.set("no-adoption", "");
    await page.goto(`http://hydration.test/?${params}`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.locator("#text").fill("User typed");
    await page.locator("#notes").fill("User notes");
    await page.locator("#checked").check();
    await page.locator("#radio-b").check();
    await page.locator("#single").selectOption("b");
    await page.locator("#multiple").selectOption(["b", "c"]);
    await page.getByRole("button", { name: "Hydrate" }).click();
    await expect(page.locator("#form > div")).toHaveAttribute("data-tick", "1");
    const preserve = uncontrolled || adoption;
    await expect(page.locator("#text")).toHaveValue(
      preserve ? "User typed" : "Server",
    );
    await expect(page.locator("#notes")).toHaveValue(
      preserve ? "User notes" : "Server",
    );
    await expect(page.locator("#checked")).toBeChecked({ checked: preserve });
    await expect(page.locator("#radio-a")).toBeChecked({ checked: !preserve });
    await expect(page.locator("#radio-b")).toBeChecked({ checked: preserve });
    await expect(page.locator("#single")).toHaveValue(preserve ? "b" : "a");
    await expect(page.locator("#multiple")).toHaveValues(
      preserve ? ["b", "c"] : ["a"],
    );
    if (!uncontrolled)
      await expect(page.locator("#state")).toHaveText(
        JSON.stringify({
          text: preserve ? "User typed" : "Server",
          notes: preserve ? "User notes" : "Server",
          checked: preserve,
          choice: preserve ? "b" : "a",
          single: preserve ? "b" : "a",
          multiple: preserve ? ["b", "c"] : ["a"],
        }),
      );
    expect(errors).toEqual([]);
  });
}

test("delivers native input/change once when a click hydrates a checkbox", async ({
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

test("allows adoption to reject a checkbox edit without inventing native events", async ({
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

test("cancels a hydration click without adopting tentative state or checking on a later render", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation&cancel");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    (document.getElementById("checked") as HTMLInputElement).click();
  });
  await expect(page.locator("#checked")).not.toBeChecked();
  await expect(page.locator("body")).toHaveAttribute(
    "data-adoption-count",
    "0",
  );
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "0");
  await page.locator("#text").fill("After");
  await expect(page.locator("#state")).toContainText('"checked":false');
  await expect(page.locator("#checked")).not.toBeChecked();
  await page.locator("#checked").check();
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "1");
});

test("delivers native activation nested inside an input handler during hydration", async ({
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

test("keeps focused text change timing native through hydration and blur", async ({
  page,
}) => {
  await page.goto("http://hydration.test/");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.locator("#text").fill("User typed");
  // A programmatic click does not blur the focused text control.
  await page.evaluate(() => document.getElementById("hydrate")!.click());
  await expect(page.locator("#text")).toBeFocused();
  await expect(page.locator("#text")).toHaveValue("User typed");
  await expect(page.locator("body")).toHaveAttribute(
    "data-text-change-count",
    "0",
  );
  await page.getByRole("button", { name: "Hydrate" }).focus();
  await expect(page.locator("body")).toHaveAttribute(
    "data-text-change-count",
    "1",
  );
});

test("cancelled radio hydration restores the selected peer without adoption", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation&cancel");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    (document.getElementById("radio-b") as HTMLInputElement).click();
  });
  await expect(page.locator("#radio-a")).toBeChecked();
  await expect(page.locator("#radio-b")).not.toBeChecked();
  await expect(page.locator("body")).toHaveAttribute(
    "data-radio-adoption-count",
    "0",
  );
  await page.locator("#text").fill("After");
  await expect(page.locator("#state")).toContainText('"choice":"a"');
  await expect(page.locator("#radio-a")).toBeChecked();
});

test("delivers a second activation after cancellation in the same task", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?activation&cancel");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.getElementById("hydrate")!.click();
    const field = document.getElementById("checked") as HTMLInputElement;
    field.click();
    field.click();
  });
  await expect(page.locator("#checked")).toBeChecked();
  await expect(page.locator("#state")).toContainText('"checked":true');
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "1");
});

test("waits through trusted click listener microtasks before adopting cancelled state", async ({
  page,
}) => {
  await page.goto("http://hydration.test/?trusted&cancel");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.locator("#checked").click();
  await expect(page.locator("#form > div")).toHaveAttribute("data-tick", "2");
  await expect(page.locator("#checked")).not.toBeChecked();
  await expect(page.locator("body")).toHaveAttribute(
    "data-adoption-count",
    "0",
  );
  await expect(page.locator("body")).toHaveAttribute("data-input-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-change-count", "0");
  await page.locator("#text").fill("After");
  await expect(page.locator("#state")).toContainText('"checked":false');
  await expect(page.locator("#checked")).not.toBeChecked();
});
