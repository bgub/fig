import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { figSourceResolveAliases } from "../../scripts/lib/fig-source-aliases.ts";
import { collectBrowserErrors } from "./browser-errors.ts";

let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    resolve: { alias: figSourceResolveAliases() },
    define: { __FIG_DEV__: "true", "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(
          new URL("./fixtures/submenu.tsx", import.meta.url),
        ),
        name: "SubmenuFixture",
        formats: ["iife"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !("output" in output))
    throw new Error("Missing bundle");
  const entry = output.output.find(
    (item) => item.type === "chunk" && item.isEntry,
  );
  if (entry?.type !== "chunk") throw new Error("Missing entry");
  fixture = entry.code;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`<div id="fixture"></div><style>
    [popover] { position: fixed; inset: auto; margin: 0; }
    [data-parent] { left: 20px; top: 60px; }
    [data-child] { left: 220px; top: 60px; }
    button { display: block; padding: 12px; }
    [data-outside] { position: fixed; left: 650px; top: 20px; }
  </style>`);
  await page.addScriptTag({ content: fixture });
  await page.locator("[data-root-trigger]").press("ArrowDown");
  await expect(page.locator("[data-trigger]")).toBeFocused();
});

for (const direction of ["ltr", "rtl"] as const) {
  test(`focus does not open; arrows enter and return: ${direction}`, async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page
      .locator("html")
      .evaluate((node, dir) => node.setAttribute("dir", dir), direction);
    const trigger = page.locator("[data-trigger]");
    const child = page.locator("[data-child]");
    await expect(child).toBeHidden();
    await trigger.press("ArrowDown");
    await expect(page.locator("[data-sibling]")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(trigger).toBeFocused();
    await expect(child).toBeHidden();
    await trigger.press(direction === "ltr" ? "ArrowRight" : "ArrowLeft");
    await expect(page.locator("[data-item]")).toBeFocused();
    await page.keyboard.press(direction === "ltr" ? "ArrowLeft" : "ArrowRight");
    await expect(child).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-parent]")).toBeHidden();
    expect(errors()).toEqual([]);
  });
}

for (const key of ["Enter", "Space"] as const) {
  test(`${key} enters a hover-opened submenu then toggles on reactivation`, async ({
    page,
  }) => {
    const trigger = page.locator("[data-trigger]");
    await trigger.hover();
    await expect(page.locator("[data-child]")).toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.press(key);
    await expect(page.locator("[data-item]")).toBeFocused();
    await trigger.focus();
    await trigger.press(key);
    await expect(page.locator("[data-child]")).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("mouse clicks enter an already open child", async ({ page }) => {
  const trigger = page.locator("[data-trigger]");
  await trigger.hover();
  await expect(page.locator("[data-child]")).toBeVisible();
  await trigger.click();
  await expect(page.locator("[data-item]")).toBeFocused();
  await trigger.click();
  await expect(page.locator("[data-item]")).toBeFocused();
  await expect(page.locator("[data-child]")).toBeVisible();
});

test("virtual clicks can close the child without closing the parent", async ({
  page,
}) => {
  const trigger = page.locator("[data-trigger]");
  await trigger.evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.locator("[data-child]")).toBeVisible();
  await trigger.focus();
  await trigger.evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.locator("[data-child]")).toBeHidden();
  await expect(page.locator("[data-parent]")).toBeVisible();
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("a second tap closes the child", async ({ page }) => {
    const trigger = page.locator("[data-trigger]");
    await trigger.tap();
    await expect(page.locator("[data-child]")).toBeVisible();
    await trigger.tap();
    await expect(page.locator("[data-child]")).toBeHidden();
    await expect(page.locator("[data-parent]")).toBeVisible();
  });
});

test("Escape dismisses a hover preview before its parent", async ({ page }) => {
  await page.locator("[data-trigger]").hover();
  await expect(page.locator("[data-child]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-child]")).toBeHidden();
  await expect(page.locator("[data-parent]")).toBeVisible();
  await expect(page.locator("[data-trigger]")).toBeFocused();
});

test("Escape from inside the child restores trigger focus", async ({
  page,
}) => {
  await page.locator("[data-trigger]").press("ArrowRight");
  await expect(page.locator("[data-item]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-child]")).toBeHidden();
  await expect(page.locator("[data-trigger]")).toBeFocused();
  await expect(page.locator("[data-parent]")).toBeVisible();
});

for (const side of ["right", "left", "bottom", "top"] as const) {
  test(`pointer travel bridges a gap with the child placed ${side}`, async ({
    page,
  }) => {
    await page.addStyleTag({
      content: `
      #fixture [data-parent] { left: 350px; top: 350px; width: 140px; }
      [data-child] { width: 160px; height: 160px; }
    `,
    });
    const trigger = page.locator("[data-trigger]");
    const child = page.locator("[data-child]");
    const box = await trigger.boundingBox();
    if (box === null) throw new Error("Missing trigger box");
    const horizontal = side === "left" || side === "right";
    const forward = side === "right" || side === "bottom";
    const x =
      side === "right"
        ? box.x + box.width + 100
        : side === "left"
          ? box.x - 270
          : box.x;
    const y =
      side === "bottom"
        ? box.y + box.height + 100
        : side === "top"
          ? box.y - 270
          : box.y;
    await child.evaluate(
      (node, position) => {
        node.style.left = `${position.x}px`;
        node.style.top = `${position.y}px`;
      },
      { x, y },
    );
    await trigger.hover();
    await expect(child).toBeVisible();
    const popup = await child.boundingBox();
    if (popup === null) throw new Error("Missing popup box");
    const departure = horizontal
      ? {
          x: forward ? box.x + box.width + 2 : box.x - 2,
          y: box.y + box.height / 2,
        }
      : {
          x: box.x + box.width / 2,
          y: forward ? box.y + box.height + 2 : box.y - 2,
        };
    const arrival = horizontal
      ? {
          x: forward ? popup.x + 2 : popup.x + popup.width - 2,
          y: popup.y + popup.height / 2,
        }
      : {
          x: popup.x + popup.width / 2,
          y: forward ? popup.y + 2 : popup.y + popup.height - 2,
        };
    await page.mouse.move(departure.x, departure.y);
    await page.mouse.move(
      (departure.x + arrival.x) / 2,
      (departure.y + arrival.y) / 2,
    );
    await page.waitForTimeout(180); // Beyond normal close delay, within travel grace.
    await expect(child).toBeVisible();
    await page.mouse.move(arrival.x, arrival.y);
    await page.waitForTimeout(350);
    await expect(child).toBeVisible();
    const returnDeparture = horizontal
      ? { x: forward ? popup.x - 2 : popup.x + popup.width + 2, y: arrival.y }
      : { x: arrival.x, y: forward ? popup.y - 2 : popup.y + popup.height + 2 };
    const returnArrival = horizontal
      ? {
          x: forward ? box.x + box.width - 2 : box.x + 2,
          y: box.y + box.height / 2,
        }
      : {
          x: box.x + box.width / 2,
          y: forward ? box.y + box.height - 2 : box.y + 2,
        };
    await page.mouse.move(returnDeparture.x, returnDeparture.y);
    await page.mouse.move(
      (returnDeparture.x + returnArrival.x) / 2,
      (returnDeparture.y + returnArrival.y) / 2,
    );
    await page.waitForTimeout(180);
    await expect(child).toBeVisible();
    await page.mouse.move(returnArrival.x, returnArrival.y);
    await page.waitForTimeout(350);
    await expect(child).toBeVisible();
    // Leaving the corridor should close, even when focus stays on the trigger.
    await page.mouse.move(5, 5);
    await page.mouse.move(0, 0);
    await expect(child).toBeHidden();
  });
}

test("a stationary pointer in the gap eventually closes the child", async ({
  page,
}) => {
  const trigger = page.locator("[data-trigger]");
  await trigger.hover();
  await expect(page.locator("[data-child]")).toBeVisible();
  const box = await trigger.boundingBox();
  if (box === null) throw new Error("Missing trigger box");
  await page.mouse.move(box.x + box.width + 5, box.y + box.height / 2);
  await expect(page.locator("[data-child]")).toBeHidden();
});

test("native dismissal preserves focus moved to an outside control", async ({
  page,
}) => {
  await page.locator("[data-trigger]").press("ArrowRight");
  await expect(page.locator("[data-item]")).toBeFocused();
  await page.locator("[data-outside]").click();
  await expect(page.locator("[data-parent]")).toBeHidden();
  await expect(page.locator("[data-child]")).toBeHidden();
  await expect(page.locator("[data-outside]")).toBeFocused();
});

test("selection preserves focus deliberately moved by the caller", async ({
  page,
}) => {
  await page.locator("[data-trigger]").press("ArrowRight");
  await expect(page.locator("[data-item]")).toBeFocused();
  await page.locator("[data-redirect]").press("Enter");
  await expect(page.locator("[data-parent]")).toBeHidden();
  await expect(page.locator("[data-outside]")).toBeFocused();
});
