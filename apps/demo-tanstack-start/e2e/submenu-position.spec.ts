import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "../../../tests/browser/browser-errors.ts";

for (const scenario of [
  "normal",
  "right edge",
  "bottom edge",
  "narrow",
  "rtl",
] as const) {
  test(`submenu stays beside its trigger and inside the viewport: ${scenario}`, async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({
      width: scenario === "narrow" ? 320 : 1000,
      height: 720,
    });
    await page.goto("/");
    await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
    if (scenario === "rtl") {
      await page
        .locator("html")
        .evaluate((element) => element.setAttribute("dir", "rtl"));
    }
    if (scenario === "right edge" || scenario === "bottom edge") {
      await page.addStyleTag({
        content: `[data-menu-demo-trigger] {
        position: fixed;
        right: 12px;
        ${scenario === "bottom edge" ? "bottom: 12px" : "top: 80px"};
      }`,
      });
    }
    const rootTrigger = page.locator("[data-menu-demo-trigger]");
    const parent = page.locator("[data-menu-demo]");
    const trigger = page.locator("[data-menu-demo-submenu-trigger]");
    const submenu = page.locator("[data-menu-demo-submenu]");
    await rootTrigger.press("ArrowDown");
    await trigger.hover();
    await expect(submenu).toBeVisible();
    const anchor = await trigger.boundingBox();
    const child = await submenu.boundingBox();
    const menu = await parent.boundingBox();
    const viewport = page.viewportSize();
    if (
      anchor === null ||
      child === null ||
      menu === null ||
      viewport === null
    ) {
      throw new Error("Missing open menu geometry");
    }
    for (const box of [menu, child]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    if (scenario === "narrow") {
      // Neither side fits: the fallback stacks directly above or below Share.
      const gap = Math.min(
        Math.abs(child.y - anchor.y - anchor.height),
        Math.abs(anchor.y - child.y - child.height),
      );
      expect(gap).toBeLessThanOrEqual(5);
      expect(child.x).toBeLessThan(anchor.x + anchor.width);
      expect(child.x + child.width).toBeGreaterThan(anchor.x);
    } else {
      const opensLeft = scenario !== "normal";
      const gap = opensLeft
        ? anchor.x - child.x - child.width
        : child.x - anchor.x - anchor.width;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(5);
      // The submenu remains vertically adjacent even if it flips upwards.
      expect(child.y).toBeLessThan(anchor.y + anchor.height);
      expect(child.y + child.height).toBeGreaterThan(anchor.y);
    }
    // Traverse from Share to its child with the pointer, then select it.
    const email = page.locator('[data-menu-demo-submenu-item="email"]');
    await email.hover();
    await expect(submenu).toBeVisible();
    await email.click();
    await expect(page.locator("[data-menu-demo-chosen]")).toHaveText("email");
    await expect(parent).toBeHidden();
    await expect(rootTrigger).toBeFocused();
    expect(errors()).toEqual([]);
  });
}

for (const direction of ["ltr", "rtl"] as const) {
  test(`focusing a submenu trigger reveals it without moving focus: ${direction}`, async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.goto("/");
    await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
    await page
      .locator("html")
      .evaluate((element, dir) => element.setAttribute("dir", dir), direction);
    const root = page.locator("[data-menu-demo-trigger]");
    const trigger = page.locator("[data-menu-demo-submenu-trigger]");
    const submenu = page.locator("[data-menu-demo-submenu]");
    const email = page.locator('[data-menu-demo-submenu-item="email"]');
    const openKey = direction === "ltr" ? "ArrowRight" : "ArrowLeft";
    const closeKey = direction === "ltr" ? "ArrowLeft" : "ArrowRight";
    await root.press("ArrowDown");
    await page
      .getByRole("menuitem", { name: "rename", exact: true })
      .press("End");
    await page
      .getByRole("menuitem", { name: "remove", exact: true })
      .press("ArrowUp");
    await expect(trigger).toBeFocused();
    await expect(submenu).toBeVisible();

    await trigger.press("ArrowUp");
    await expect(
      page.getByRole("menuitemradio", { name: "Sort by date" }),
    ).toBeFocused();
    await expect(submenu).toBeHidden();
    await page
      .getByRole("menuitemradio", { name: "Sort by date" })
      .press("ArrowDown");
    await expect(trigger).toBeFocused();
    await expect(submenu).toBeVisible();

    await trigger.press(openKey);
    await expect(email).toBeFocused();
    await email.press(closeKey);
    await expect(trigger).toBeFocused();
    await expect(submenu).toBeHidden();

    await trigger.press(openKey);
    await expect(email).toBeFocused();
    await email.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(submenu).toBeHidden();

    // A pointer click includes focus before activation; it must not toggle
    // the newly revealed submenu closed again.
    await trigger.press("ArrowUp");
    await trigger.click();
    await expect(submenu).toBeVisible();
    await expect(email).toBeFocused();
    await email.press("Enter");
    await expect(page.locator("[data-menu-demo]")).toBeHidden();
    await expect(root).toBeFocused();
    expect(errors()).toEqual([]);
  });
}
