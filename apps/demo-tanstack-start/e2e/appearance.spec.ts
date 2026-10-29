import { expect, type Locator, test } from "@playwright/test";
import { collectBrowserErrors } from "../../../tests/browser/browser-errors.ts";

declare global {
  interface Window {
    __widgetTransitionGroups: Promise<string[]>[];
  }
}

test("leaving and returning home does not animate detached widget panels", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    const original = document.startViewTransition.bind(document);
    window.__widgetTransitionGroups = [];
    document.startViewTransition = (update) => {
      const transition = original(update);
      window.__widgetTransitionGroups.push(
        transition.ready.then(
          () =>
            document.getAnimations().flatMap((animation) => {
              const pseudo = (animation.effect as KeyframeEffect | null)
                ?.pseudoElement;
              return pseudo === null || pseudo === undefined ? [] : [pseudo];
            }),
          () => [],
        ),
      );
      return transition;
    };
  });
  await page.goto("/");
  await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "About", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-tabs-demo-frame]")).toHaveCount(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Components", exact: true }),
  ).toBeVisible();
  const groups = await page.evaluate(async () =>
    (await Promise.all(window.__widgetTransitionGroups)).flat(),
  );
  expect(
    groups.filter((group) => /tabs-demo-panel|accordion-demo-/.test(group)),
  ).toEqual([]);
  expect(errors()).toEqual([]);
});

for (const { theme, colorScheme } of [
  { theme: "Light", colorScheme: "light" },
  { theme: "Dark", colorScheme: "dark" },
  { theme: "System", colorScheme: "light" },
  { theme: "System", colorScheme: "dark" },
] as const) {
  test(`widget states have readable contrast with ${theme} theme and ${colorScheme} system`, async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
    const themeButton = page.getByRole("button", { name: theme, exact: true });
    await themeButton.click();
    await expect(themeButton).toHaveAttribute("aria-pressed", "true");
    await expectReadable(themeButton);
    await expectReadable(
      page.getByRole("tab", { name: "Composition", exact: true }),
    );
    await expectReadable(
      page.getByRole("tab", { name: "Keyboard", exact: true }),
    );
    await expectReadable(page.locator('[data-radio-demo-label="standard"]'));
    await expectReadable(page.locator("[data-form-demo-submit]"));
    await expectReadable(page.locator("[data-form-demo-hint]"));
    await expectReadable(page.locator("[data-listbox-demo-value]"));
    await expectReadable(
      page.locator("[data-combobox-demo-input]"),
      "::placeholder",
    );

    const listbox = page.locator("[data-listbox-demo]");
    await listbox.focus();
    await listbox.press("ArrowDown");
    await expect(
      page.locator('[data-listbox-demo-option="banana"]'),
    ).toHaveAttribute("data-highlighted", "");
    await expectReadable(page.locator('[data-listbox-demo-option="banana"]'));
    await expectReadable(page.locator('[data-listbox-demo-option="apple"]'));
    await listbox.press("ArrowUp");
    await expectReadable(page.locator('[data-listbox-demo-option="apple"]'));

    await page.locator("[data-select-demo-trigger]").press("ArrowDown");
    await expect(page.locator("[data-select-demo]")).toBeVisible();
    await expectReadable(
      page.locator("[data-select-demo-option][data-highlighted]"),
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-combobox-demo-input]").press("ArrowDown");
    await expect(page.locator("[data-combobox-demo]")).toBeVisible();
    await expectReadable(
      page.locator("[data-combobox-demo-option][data-highlighted]"),
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-menu-demo-trigger]").press("ArrowDown");
    const rename = page.locator('[data-menu-demo-item="rename"]');
    await expect(rename).toBeFocused();
    await expectReadable(rename);
    await page.keyboard.press("Escape");
    const bold = page.locator('[data-toolbar-demo-item="bold"]');
    await bold.hover();
    await expectReadable(bold);
    expect(errors()).toEqual([]);
  });
}

for (const theme of ["Light", "Dark"] as const) {
  test(`menu hover and focus remain distinguishable in ${theme} mode`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.locator("[data-menu-demo-trigger]").press("ArrowDown");
    const menu = page.locator("[data-menu-demo]");
    const rename = page.locator('[data-menu-demo-item="rename"]');
    const sort = page.locator('[data-menu-demo-radio="name"]');
    await sort.hover();
    await expect(rename).toBeFocused();
    await expect(sort).not.toBeFocused();
    await expectFocusOutline(rename);
    await expect(sort).toHaveCSS("outline-style", "none");
    expect(
      await sort.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).not.toBe(
      await rename.evaluate((node) => getComputedStyle(node).backgroundColor),
    );

    // Clicking empty padding focuses the container, which must also show focus.
    await menu.click({ position: { x: 2, y: 10 } });
    await expect(menu).toBeFocused();
    await expect(menu.locator("button:focus")).toHaveCount(0);
    await expectFocusOutline(menu);
    await menu.press("ArrowDown");
    await expect(rename).toBeFocused();
    await expectFocusOutline(rename);
    await expect(menu).toHaveCSS("outline-style", "none");

    // The same indicator follows focus into the nested menu.
    await page.locator("[data-menu-demo-submenu-trigger]").press("ArrowRight");
    const email = page.locator('[data-menu-demo-submenu-item="email"]');
    const submenu = page.locator("[data-menu-demo-submenu]");
    await expect(email).toBeFocused();
    await expectFocusOutline(email);
    await submenu.click({ position: { x: 2, y: 10 } });
    await expect(submenu).toBeFocused();
    await expectFocusOutline(submenu);
  });
}

async function expectFocusOutline(locator: Locator): Promise<void> {
  await expect(locator).toHaveCSS("outline-style", "solid");
  const outline = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      width: Number.parseFloat(style.outlineWidth),
      color: style.outlineColor,
    };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
}

async function expectReadable(
  locator: Locator,
  pseudoElement?: string,
): Promise<void> {
  const colors = await locator.evaluate((element, pseudo) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Missing canvas context");
    const rgba = (color: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const foreground = getComputedStyle(element, pseudo).color;
    let parent: Element | null = element;
    let background = "";
    while (parent !== null) {
      background = getComputedStyle(parent).backgroundColor;
      if (rgba(background)[3] === 255) break;
      parent = parent.parentElement;
    }
    if (parent === null) throw new Error("No opaque background found");
    function luminance(rgb: number[]): number {
      const channels = rgb.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    }
    const bg = rgba(background);
    const fg = rgba(foreground);
    const alpha = fg[3]! / 255;
    const light = luminance(
      fg
        .slice(0, 3)
        .map((channel, i) => channel * alpha + bg[i]! * (1 - alpha)),
    );
    const dark = luminance(bg);
    return {
      foreground,
      background,
      ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
    };
  }, pseudoElement);
  expect
    .soft(colors.ratio, `${locator.toString()}: ${JSON.stringify(colors)}`)
    .toBeGreaterThanOrEqual(4.5);
}
