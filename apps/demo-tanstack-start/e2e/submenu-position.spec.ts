import { expect, test, type Page } from "@playwright/test";
import { collectBrowserErrors } from "../../../tests/browser/browser-errors.ts";

for (const scenario of [
  "normal",
  "right edge",
  "bottom edge",
  "narrow",
  "rtl",
  "scrolled fixed trigger",
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
    if (scenario === "scrolled fixed trigger")
      await page.evaluate(() => window.scrollTo(0, 400));
    if (
      scenario === "right edge" ||
      scenario === "bottom edge" ||
      scenario === "scrolled fixed trigger"
    ) {
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
  test(`submenus require explicit keyboard activation: ${direction}`, async ({
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
    await expect(submenu).toBeHidden();

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

    // Mouse activation enters the child after moving focus to its trigger.
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

for (const change of [
  "scroll",
  "ancestor scroll",
  "resize",
  "grow",
  "parent grow",
  "shrink",
] as const) {
  test(`open menus track ${change}`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.goto("/");
    await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
    if (change === "resize") {
      // Keep the anchor visible while responsive content above it reflows.
      await page.addStyleTag({
        content:
          "[data-menu-demo-trigger] {position:fixed;left:20px;top:100px}",
      });
    }
    if (change === "ancestor scroll") {
      await page.addStyleTag({ content: "[data-menu-demo] {height:160px}" });
    }
    const root = page.locator("[data-menu-demo-trigger]");
    const trigger = page.locator("[data-menu-demo-submenu-trigger]");
    await root.press("ArrowDown");
    await expect(page.locator('[data-menu-demo-item="rename"]')).toBeFocused();
    await trigger.press("ArrowRight");
    await expect(
      page.locator('[data-menu-demo-submenu-item="email"]'),
    ).toBeFocused();
    await expectMenusPlaced(page);
    if (change === "scroll") {
      await page.evaluate(() => window.scrollBy(0, 100));
    } else if (change === "ancestor scroll") {
      await page.locator("[data-menu-demo]").evaluate((node) => {
        node.scrollTop -= 12;
      });
    } else if (change === "parent grow") {
      await trigger.evaluate((node) => {
        const extra = document.createElement("div");
        extra.textContent = "Additional parent content";
        extra.style.height = "40px";
        node.before(extra);
      });
    } else if (change === "resize") {
      await page.setViewportSize({ width: 320, height: 600 });
    } else {
      await page.locator("[data-menu-demo-submenu]").evaluate((node, mode) => {
        if (mode === "grow") {
          const extra = document.createElement("div");
          extra.textContent =
            "Additional information about this menu item. ".repeat(10);
          node.append(extra);
        } else {
          node.lastElementChild?.remove();
        }
      }, change);
    }
    await expectMenusPlaced(page);
    await expect(
      page.locator('[data-menu-demo-submenu-item="email"]'),
    ).toBeFocused();
    expect(errors()).toEqual([]);
  });
}

async function expectMenusPlaced(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const root = document
          .querySelector("[data-menu-demo-trigger]")!
          .getBoundingClientRect();
        const parent = document
          .querySelector("[data-menu-demo]")!
          .getBoundingClientRect();
        const trigger = document
          .querySelector("[data-menu-demo-submenu-trigger]")!
          .getBoundingClientRect();
        const child = document
          .querySelector("[data-menu-demo-submenu]")!
          .getBoundingClientRect();
        const visible = (r: DOMRect) =>
          r.width > 0 &&
          r.height > 0 &&
          r.left >= -1 &&
          r.top >= -1 &&
          r.right <= innerWidth + 1 &&
          r.bottom <= innerHeight + 1;
        const adjacent = (a: DOMRect, b: DOMRect) => {
          const horizontal = Math.min(
            Math.abs(a.left - b.right),
            Math.abs(b.left - a.right),
          );
          const vertical = Math.min(
            Math.abs(a.top - b.bottom),
            Math.abs(b.top - a.bottom),
          );
          return (
            (horizontal <= 5 && a.top < b.bottom && b.top < a.bottom) ||
            (vertical <= 5 && a.left < b.right && b.left < a.right)
          );
        };
        return {
          parentVisible: visible(parent),
          childVisible: visible(child),
          parentAnchored: adjacent(root, parent),
          childAnchored: adjacent(trigger, child),
        };
      }),
    )
    .toEqual({
      parentVisible: true,
      childVisible: true,
      parentAnchored: true,
      childAnchored: true,
    });
}
