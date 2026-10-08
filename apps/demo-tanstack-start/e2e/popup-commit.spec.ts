import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { figSourceResolveAliases } from "../../../scripts/lib/fig-source-aliases.ts";
import { collectBrowserErrors } from "./browser-errors.ts";

let fixture: string;

test.describe("composite focus with native constraints", () => {
  for (const constraint of ["native", "fieldset"]) {
    test(`menu arrows and typeahead skip ${constraint} disability`, async ({
      page,
    }) => {
      const errors = collectBrowserErrors(page);
      await page.setContent(
        `<div id="fixture" data-focus-kind="menu" data-constraint="${constraint}"></div>`,
      );
      await page.addScriptTag({ content: fixture });
      const first = page.locator('[data-focus-item="first"]');
      const middle = page.locator('[data-focus-item="middle"]');
      const last = page.locator('[data-focus-item="last"]');
      await expect(middle).toBeDisabled();
      await page.locator("[data-focus-trigger]").press("ArrowDown");
      await expect(first).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(last).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(first).toBeFocused();
      await page.keyboard.press("l");
      await expect(last).toBeFocused();
      await page.keyboard.press("Home");
      await expect(first).toBeFocused();
      expect(errors()).toEqual([]);
    });

    test(`tabs arrows skip ${constraint} disability`, async ({ page }) => {
      const errors = collectBrowserErrors(page);
      await page.setContent(
        `<div id="fixture" data-focus-kind="tabs" data-constraint="${constraint}"></div>`,
      );
      await page.addScriptTag({ content: fixture });
      const first = page.locator('[data-focus-item="first"]');
      const last = page.locator('[data-focus-item="last"]');
      await expect(page.locator('[data-focus-item="middle"]')).toBeDisabled();
      await first.focus();
      await page.keyboard.press("ArrowRight");
      await expect(last).toBeFocused();
      await expect(last).toHaveAttribute("tabindex", "0");
      await page.keyboard.press("ArrowRight");
      await expect(first).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(last).toBeFocused();
      expect(errors()).toEqual([]);
    });
  }

  test("menu entry and edge keys skip native-disabled first and last items", async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.setContent(
      '<div id="fixture" data-focus-kind="menu" data-disabled="edges"></div>',
    );
    await page.addScriptTag({ content: fixture });
    const middle = page.locator('[data-focus-item="middle"]');
    const trigger = page.locator("[data-focus-trigger]");
    await trigger.press("ArrowDown");
    await expect(middle).toBeFocused();
    await page.keyboard.press("Home");
    await expect(middle).toBeFocused();
    await page.keyboard.press("End");
    await expect(middle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.press("ArrowUp");
    await expect(middle).toBeFocused();
    expect(errors()).toEqual([]);
  });

  test("a menu with only native-disabled items focuses its container", async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.setContent(
      '<div id="fixture" data-focus-kind="menu" data-disabled="all"></div>',
    );
    await page.addScriptTag({ content: fixture });
    await page.locator("[data-focus-trigger]").press("ArrowDown");
    await expect(page.locator("[data-focus-menu]")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-focus-menu]")).toBeFocused();
    expect(errors()).toEqual([]);
  });

  for (const kind of ["menu", "tabs"]) {
    test(`${kind} keeps ARIA-disabled items focusable`, async ({ page }) => {
      const errors = collectBrowserErrors(page);
      await page.setContent(
        `<div id="fixture" data-focus-kind="${kind}" data-constraint="aria"></div>`,
      );
      await page.addScriptTag({ content: fixture });
      const first = page.locator('[data-focus-item="first"]');
      const middle = page.locator('[data-focus-item="middle"]');
      if (kind === "menu") {
        await page.locator("[data-focus-trigger]").press("ArrowDown");
        await expect(first).toBeFocused();
      } else await first.focus();
      await page.keyboard.press(kind === "menu" ? "ArrowDown" : "ArrowRight");
      await expect(middle).toBeFocused();
      await expect(middle).toHaveAttribute("aria-disabled", "true");
      await expect(middle).toHaveJSProperty("disabled", false);
      await page.keyboard.press("Enter");
      if (kind === "menu")
        await expect(page.locator("[data-focus-trigger]")).toHaveAttribute(
          "aria-expanded",
          "true",
        );
      else await expect(first).toHaveAttribute("aria-selected", "true");
      expect(errors()).toEqual([]);
    });
  }

  test("a selected native-disabled tab leaves an enabled sequential tab stop", async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.setContent(
      '<div id="fixture" data-focus-kind="tabs" data-selected-disabled="true"></div>',
    );
    await page.addScriptTag({ content: fixture });
    const first = page.locator('[data-focus-item="first"]');
    const middle = page.locator('[data-focus-item="middle"]');
    await expect(middle).toHaveAttribute("aria-selected", "true");
    await expect(first).toHaveAttribute("tabindex", "0");
    await expect(middle).toHaveAttribute("tabindex", "-1");
    await page.locator("[data-outside]").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-focus-item="last"]')).toBeFocused();
    expect(errors()).toEqual([]);
  });
});

test.beforeAll(async () => {
  // Exercise real native popover dismissal without depending on demo layout.
  const result = await build({
    configFile: false,
    resolve: { alias: figSourceResolveAliases() },
    define: { __FIG_DEV__: "true", "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(
          new URL("./fixtures/popup-commit.tsx", import.meta.url),
        ),
        name: "PopupCommitFixture",
        formats: ["iife"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !("output" in output)) {
    throw new Error("Expected a bundled popup fixture.");
  }
  const entry = output.output.find(
    (item) => item.type === "chunk" && item.isEntry,
  );
  if (entry?.type !== "chunk") throw new Error("Missing popup fixture entry.");
  fixture = entry.code;
});

test("keyboard switching respects native dismissal during a shared commit", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.setContent(
    '<!doctype html><html><body><div id="fixture"></div></body></html>',
  );
  await page.addScriptTag({ content: fixture });
  expect(errors()).toEqual([]);
  const first = page.locator("[data-first-trigger]");
  const second = page.locator("[data-second-trigger]");

  await second.focus();
  await second.press("ArrowDown");
  await expect(page.locator("[data-second-item]")).toBeFocused();

  // No pointerdown: clicking would dismiss the old popup before the commit.
  await first.focus();
  await first.press("ArrowDown");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-first-menu]")).toBeVisible();
  await expect(page.locator("[data-second-menu]")).toBeHidden();
  await expect(page.locator("[data-first-item]")).toBeFocused();

  await second.focus();
  await second.press("ArrowDown");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-second-item]")).toBeFocused();
  await second.press("Escape");
  await expect(second).toHaveAttribute("aria-expanded", "false");
  expect(errors()).toEqual([]);
});

for (const kind of ["popover", "combobox", "tooltip"]) {
  test(`opening a menu preserves native dismissal of a peer ${kind}`, async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.setContent('<div id="fixture"></div>');
    await page.addScriptTag({ content: fixture });
    await page.locator(`[data-${kind}-trigger]`).click();
    const peer = page.locator(`[data-${kind}]`);
    await expect(peer).toBeVisible();

    const trigger = page.locator("[data-first-trigger]");
    await trigger.focus();
    await trigger.press("ArrowDown");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(peer).toBeHidden();
    await expect(page.locator("[data-first-item]")).toBeFocused();
    expect(errors()).toEqual([]);
  });
}

test("a controlled popup reopens after a refused native dismissal", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.setContent('<div id="fixture" data-controlled="true"></div>');
  await page.addScriptTag({ content: fixture });
  const popup = page.locator("[data-popover]");
  await expect(popup).toBeVisible();
  await popup.evaluate((node) => {
    if (!(node instanceof HTMLElement))
      throw new Error("Expected a popup host.");
    node.hidePopover();
  });
  await expect(popup).toBeVisible();
  await expect(page.locator("[data-popover-trigger]")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(errors()).toEqual([]);
});

test("native dismissal survives an urgent commit before its queued state update", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.setContent('<div id="fixture"></div>');
  await page.addScriptTag({ content: fixture });
  const trigger = page.locator("[data-popover-trigger]");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => {
    const popup = document.querySelector("[data-popover]");
    const menuTrigger = document.querySelector("[data-first-trigger]");
    if (
      !(popup instanceof HTMLElement) ||
      !(menuTrigger instanceof HTMLElement)
    )
      throw new Error("Missing popup hosts.");
    popup.hidePopover();
    menuTrigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator("[data-first-menu]")).toBeVisible();
  await expect(page.locator("[data-popover]")).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(errors()).toEqual([]);
});

test("a replacement popup host opens while its widget remains open", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.setContent('<div id="fixture"></div>');
  await page.addScriptTag({ content: fixture });
  await page.locator("[data-popover-trigger]").click();
  const popup = page.locator("[data-popover]");
  await expect(popup).toBeVisible();
  const oldHost = await popup.elementHandle();
  // Programmatic click avoids native pointer light dismissal before replacing.
  await page.locator("[data-replace]").evaluate((node) => {
    if (!(node instanceof HTMLButtonElement))
      throw new Error("Expected a button.");
    node.click();
  });
  await expect
    .poll(() => oldHost?.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect(popup).toBeVisible();
  await expect(page.locator("[data-popover-trigger]")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(errors()).toEqual([]);
});
