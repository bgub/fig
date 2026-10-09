import { expect, test, type Page } from "@playwright/test";
import { collectBrowserErrors } from "../../../tests/browser/browser-errors.ts";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.dataset.outside = "";
    input.setAttribute("aria-label", "Outside floating widgets");
    input.style.cssText =
      "position:fixed;left:10px;top:10px;width:100px;z-index:100";
    document.body.append(input);
  });
});

const widgets = [
  {
    name: "popover",
    anchor: "[data-popover-demo-trigger]",
    popup: "[data-popover-demo]",
    key: "Enter",
  },
  {
    name: "tooltip",
    anchor: "[data-tooltip-demo-trigger]",
    popup: "[data-tooltip-demo]",
    key: null,
  },
  {
    name: "select",
    anchor: "[data-select-demo-trigger]",
    popup: "[data-select-demo]",
    key: "ArrowDown",
  },
  {
    name: "combobox",
    anchor: "[data-combobox-demo-input]",
    popup: "[data-combobox-demo]",
    key: "ArrowDown",
  },
] as const;

for (const widget of widgets) {
  for (const direction of ["ltr", "rtl"] as const) {
    test(`${widget.name} composes positioning and keyboard dismissal: ${direction}`, async ({
      page,
    }) => {
      const errors = collectBrowserErrors(page);
      await page
        .locator("html")
        .evaluate((node, dir) => node.setAttribute("dir", dir), direction);
      await page.addStyleTag({
        content: `${widget.anchor} {position:fixed;right:12px;bottom:12px}`,
      });
      const anchor = page.locator(widget.anchor);
      const popup = page.locator(widget.popup);
      await anchor.focus();
      if (widget.key !== null) await anchor.press(widget.key);
      await expect(popup).toBeVisible();
      await expectPlaced(page, widget.anchor, widget.popup);
      if (widget.name === "popover")
        await expect(page.locator("[data-popover-demo-filter]")).toBeFocused();
      else await expect(anchor).toBeFocused();
      await page.setViewportSize({ width: 320, height: 420 });
      await expectPlaced(page, widget.anchor, widget.popup);
      await page.keyboard.press("Escape");
      await expect(popup).toBeHidden();
      await expect(anchor).toBeFocused();
      expect(errors()).toEqual([]);
    });
  }
}

test("Select reveals keyboard and opening highlights without moving DOM focus", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.addStyleTag({ content: "[data-select-demo] {max-height:55px}" });
  const trigger = page.locator("[data-select-demo-trigger]");
  const popup = page.locator("[data-select-demo]");
  await trigger.press("ArrowDown");
  await trigger.press("End");
  await expect(
    page.locator('[data-select-demo-option="pear"]'),
  ).toHaveAttribute("data-highlighted", "");
  await expectActiveVisible(
    page,
    "[data-select-demo-trigger]",
    "[data-select-demo]",
  );
  await expect(trigger).toBeFocused();
  await trigger.press("Home");
  await expect(
    page.locator('[data-select-demo-option="apple"]'),
  ).toHaveAttribute("data-highlighted", "");
  await expectActiveVisible(
    page,
    "[data-select-demo-trigger]",
    "[data-select-demo]",
  );
  await trigger.press("p");
  await expect(
    page.locator('[data-select-demo-option="pear"]'),
  ).toHaveAttribute("data-highlighted", "");
  await expectActiveVisible(
    page,
    "[data-select-demo-trigger]",
    "[data-select-demo]",
  );
  await trigger.press("Enter");
  await expect(popup).toBeHidden();
  await expect(trigger).toHaveText("pear");
  await expect(trigger).toBeFocused();
  // Reset the retained scroll position while closed, then open by activation.
  await popup.evaluate((node) => {
    node.scrollTop = 0;
  });
  await trigger.press("Enter");
  await expect(popup).toBeVisible();
  await expectActiveVisible(
    page,
    "[data-select-demo-trigger]",
    "[data-select-demo]",
  );
  await page.locator("[data-outside]").click();
  await expect(popup).toBeHidden();
  await expect(page.locator("[data-outside]")).toBeFocused();
  expect(errors()).toEqual([]);
});

test("Combobox scrolls virtual focus and preserves input focus on selection", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.addStyleTag({ content: "[data-combobox-demo] {max-height:55px}" });
  const input = page.locator("[data-combobox-demo-input]");
  await input.press("ArrowDown");
  await expect(
    page.locator('[data-combobox-demo-option="apple"]'),
  ).toHaveAttribute("data-highlighted", "");
  // Home/End belong to text editing; ArrowUp wraps from the first option.
  await input.press("ArrowUp");
  await expect(
    page.locator('[data-combobox-demo-option="pear"]'),
  ).toHaveAttribute("data-highlighted", "");
  await expectActiveVisible(
    page,
    "[data-combobox-demo-input]",
    "[data-combobox-demo]",
  );
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(input).toHaveValue("pear");
  await expect(input).toBeFocused();
  await expect(page.locator("[data-combobox-demo]")).toBeHidden();
  expect(errors()).toEqual([]);
});

test("Popover autofocus, Tab navigation, and programmatic dismissal follow native focus ownership", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const trigger = page.locator("[data-popover-demo-trigger]");
  const popup = page.locator("[data-popover-demo]");
  const filter = page.locator("[data-popover-demo-filter]");
  const apply = page.locator("[data-popover-demo-apply]");
  await trigger.press("Enter");
  await expect(filter).toBeFocused();
  // Native sequential navigation can skip buttons with Safari's default
  // keyboard settings. Focus the action explicitly to exercise closing.
  await apply.focus();
  await page.keyboard.press("Enter");
  await expect(popup).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(filter).toBeFocused();
  await page.locator("[data-outside]").click();
  await expect(popup).toBeHidden();
  await expect(page.locator("[data-outside]")).toBeFocused();
  await trigger.press("Enter");
  await apply.focus();
  await page.keyboard.press("Tab");
  expect(
    await popup.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(false);
  expect(errors()).toEqual([]);
});

test("Popover without autofocus leaves focus on its trigger", async ({
  page,
}) => {
  const trigger = page.locator("[data-popover-demo-trigger]");
  await page
    .locator("[data-popover-demo-filter]")
    .evaluate((node) => node.removeAttribute("autofocus"));
  await trigger.press("Enter");
  await expect(page.locator("[data-popover-demo]")).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("Tooltip mouse hover does not steal focus and focus keeps it open after pointer exit", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const trigger = page.locator("[data-tooltip-demo-trigger]");
  const popup = page.locator("[data-tooltip-demo]");
  const outside = page.locator("[data-outside]");
  await outside.focus();
  await trigger.hover();
  await expect(popup).toBeVisible();
  await expect(outside).toBeFocused();
  await popup.hover();
  await expect(popup).toBeVisible();
  await expect(outside).toBeFocused();
  await outside.hover();
  await expect(popup).toBeHidden();
  await trigger.focus();
  await expect(popup).toBeVisible();
  await trigger.hover();
  await outside.hover();
  await expect(popup).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.press("Escape");
  await expect(popup).toBeHidden();
  expect(errors()).toEqual([]);
});

async function expectPlaced(page: Page, anchor: string, popup: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ anchor, popup }) => {
          const a = document.querySelector(anchor)!.getBoundingClientRect();
          const p = document.querySelector(popup)!.getBoundingClientRect();
          return (
            p.width > 0 &&
            p.height > 0 &&
            p.left >= 3 &&
            p.top >= 3 &&
            p.right <= innerWidth - 3 &&
            p.bottom <= innerHeight - 3 &&
            Math.min(Math.abs(a.top - p.bottom), Math.abs(p.top - a.bottom)) <=
              5
          );
        },
        { anchor, popup },
      ),
    )
    .toBe(true);
}

async function expectActiveVisible(page: Page, anchor: string, popup: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ anchor, popup }) => {
          const id = document
            .querySelector(anchor)!
            .getAttribute("aria-activedescendant");
          const option = id === null ? null : document.getElementById(id);
          if (option === null) return false;
          const a = option.getBoundingClientRect();
          const p = document.querySelector(popup)!.getBoundingClientRect();
          return a.top >= p.top - 1 && a.bottom <= p.bottom + 1;
        },
        { anchor, popup },
      ),
    )
    .toBe(true);
}

test("Select reveals its current option when only the positioner limits height", async ({
  page,
}) => {
  const trigger = page.locator("[data-select-demo-trigger]");
  await trigger.press("ArrowDown");
  await trigger.press("End");
  await expect(
    page.locator('[data-select-demo-option="pear"]'),
  ).toHaveAttribute("data-highlighted", "");
  await trigger.press("Enter");
  await expect(trigger).toHaveText("pear");
  await page.setViewportSize({ width: 500, height: 120 });
  await page.addStyleTag({
    content: "[data-select-demo-trigger] {position:fixed;left:150px;top:30px}",
  });
  await trigger.press("Enter");
  await expect(page.locator("[data-select-demo]")).toBeVisible();
  await expectActiveVisible(
    page,
    "[data-select-demo-trigger]",
    "[data-select-demo]",
  );
  await expect(trigger).toBeFocused();
});

test("Combobox reveals a keyboard highlight after positioner height constraints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 120 });
  await page.addStyleTag({
    content: "[data-combobox-demo-input] {position:fixed;left:150px;top:30px}",
  });
  const input = page.locator("[data-combobox-demo-input]");
  await input.press("ArrowUp");
  await expect(
    page.locator('[data-combobox-demo-option="pear"]'),
  ).toHaveAttribute("data-highlighted", "");
  await expectActiveVisible(
    page,
    "[data-combobox-demo-input]",
    "[data-combobox-demo]",
  );
  await expect(input).toBeFocused();
});

test("Dialog retains native focus containment and restoration", async ({
  page,
}) => {
  const trigger = page.locator("[data-dialog-demo-trigger]");
  const dialog = page.locator("[data-dialog-demo]");
  await trigger.press("Enter");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  // A background control is inert while the modal is open.
  await page.locator("[data-outside]").evaluate((node) => node.focus());
  await expect
    .poll(() =>
      dialog.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
});
