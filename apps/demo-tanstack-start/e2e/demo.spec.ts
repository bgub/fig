import { expect, type Page, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

test("hydrates the themed document and persists shell changes", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "fig-demo-theme",
      path: "/",
      value: "dark",
    },
  ]);

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("html")).toHaveClass(/(^| )dark( |$)/);
  await expect(page.locator(".fig-tanstack-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();

  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  expect(errors()).toEqual([]);
});

test("includes the Fig DevTools overlay", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/", { waitUntil: "commit" });
  await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();

  await page.getByRole("button", { name: "Open TanStack Devtools" }).click();
  const devtools = page.locator("[data-fig-devtools]");
  await expect(devtools).toBeVisible();
  await expect(
    devtools.getByText("Fig DevTools", { exact: true }),
  ).toBeVisible();
  await expect(
    devtools.getByText("Fig TanStack Start", { exact: true }),
  ).toBeVisible();
  await expect(
    devtools.locator(".fig-devtools__tree-button").first(),
  ).toBeVisible();
  expect(errors()).toEqual([]);
});

test("renders the mixin-based tabs example", async ({ page, request }) => {
  const response = await request.get("/");
  const html = await response.text();
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain("--active-tab-left");

  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    const prototype = Document.prototype as DocumentViewTransitionHost;
    const original = prototype.startViewTransition;
    if (original === undefined) return;
    let starts = 0;
    prototype.startViewTransition = function (options) {
      starts += 1;
      return original.call(this, options);
    };
    Object.defineProperty(window, "__tabsDemoViewTransitionStarts", {
      get: () => starts,
    });
  });
  await page.goto("/");
  await page.addStyleTag({
    content: `
      ::view-transition-group(tabs-demo-panel),
      ::view-transition-old(tabs-demo-panel),
      ::view-transition-new(tabs-demo-panel) {
        animation-duration: 2s !important;
      }
    `,
  });

  await expect(
    page.getByRole("heading", { level: 2, name: "Components" }),
  ).toBeVisible();
  const composition = page.getByRole("tab", { name: "Composition" });
  const keyboard = page.getByRole("tab", { name: "Keyboard" });
  const compositionPanel = page.locator('[data-tabs-demo-panel="composition"]');
  const keyboardPanel = page.locator('[data-tabs-demo-panel="keyboard"]');
  const frame = page.locator("[data-tabs-demo-frame]");
  const indicator = page.locator("[data-tabs-demo-indicator]");
  await expect(composition).toHaveAttribute("aria-selected", "true");
  await expect(indicator).toBeVisible();
  const initialIndicatorLeft = await indicator.evaluate(
    (element) => getComputedStyle(element).left,
  );
  await expect(compositionPanel).toBeVisible();
  const compositionPanelHeight = await compositionPanel.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const compositionFrameHeight = await frame.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await keyboard.click();
  await expect(keyboard).toHaveAttribute("aria-selected", "true");
  await expect(keyboardPanel).toContainText("Left Arrow");
  const keyboardPanelHeight = await keyboardPanel.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const keyboardFrameHeight = await frame.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(keyboardPanelHeight).toBeGreaterThan(compositionPanelHeight + 50);
  expect(keyboardFrameHeight).toBeGreaterThan(compositionFrameHeight + 50);
  await expect
    .poll(() => tabsPanelAnimationNames(page))
    .toEqual(
      expect.arrayContaining([
        "tabs-demo-slide-in-right",
        "tabs-demo-slide-out-left",
      ]),
    );
  // One boundary carries both the panel content and the frame height.
  await expect
    .poll(() => viewTransitionHeightKeyframes(page, "tabs-demo-panel"))
    .toEqual([compositionFrameHeight, keyboardFrameHeight]);
  // The morphing group paints the frame chrome, so the sliding snapshots
  // cannot carry a border of their own.
  await expect
    .poll(() =>
      frame.evaluate((element) => getComputedStyle(element).borderBottomColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate(
          (element) =>
            getComputedStyle(
              element,
              "::view-transition-group(tabs-demo-panel)",
            ).borderBottomColor,
        ),
    )
    .toBe("rgb(203, 213, 225)");
  expect(await documentViewTransitionStarts(page)).toBe(1);
  await expect
    .poll(() => indicator.evaluate((element) => getComputedStyle(element).left))
    .not.toBe(initialIndicatorLeft);

  // The tab list remains live while the panel snapshot animates. Each new
  // pointer or keyboard intent replaces the animation already in flight.
  const compositionBox = await composition.boundingBox();
  if (compositionBox === null)
    throw new Error("Composition tab is not visible");
  await page.mouse.click(
    compositionBox.x + compositionBox.width / 2,
    compositionBox.y + compositionBox.height / 2,
  );
  await expect(composition).toHaveAttribute("aria-selected", "true");
  expect(await documentViewTransitionStarts(page)).toBe(2);
  await expect
    .poll(() => viewTransitionHeightKeyframes(page, "tabs-demo-panel"))
    .toEqual([keyboardFrameHeight, compositionFrameHeight]);
  await expect
    .poll(() => tabsPanelAnimationNames(page))
    .toEqual(
      expect.arrayContaining([
        "tabs-demo-slide-in-left",
        "tabs-demo-slide-out-right",
      ]),
    );

  await page.keyboard.press("ArrowRight");
  await expect(keyboard).toHaveAttribute("aria-selected", "true");
  expect(await documentViewTransitionStarts(page)).toBe(3);
  await expect
    .poll(() => tabsPanelAnimationNames(page))
    .toEqual(
      expect.arrayContaining([
        "tabs-demo-slide-in-right",
        "tabs-demo-slide-out-left",
      ]),
    );
  await expect(compositionPanel).toBeHidden();
  expect(errors()).toEqual([]);
});

test("expands an accordion panel and animates its frame", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.addStyleTag({
    content: `
      ::view-transition-group(accordion-demo-returns) {
        animation-duration: 2s !important;
      }
    `,
  });

  const shipping = page.getByRole("button", { name: /How does shipping work/ });
  const returns = page.getByRole("button", { name: /Can I return an order/ });
  const returnsFrame = page.locator('[data-accordion-demo-frame="returns"]');
  await expect(shipping).toHaveAttribute("aria-expanded", "true");
  await expect(returns).toHaveAttribute("aria-expanded", "false");

  // Headers keep their own place in the tab order.
  await shipping.focus();
  await page.keyboard.press("ArrowDown");
  await expect(returns).toBeFocused();

  const collapsedHeight = await returnsFrame.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page.keyboard.press("Enter");

  await expect(returns).toHaveAttribute("aria-expanded", "true");
  await expect(shipping).toHaveAttribute("aria-expanded", "false");
  const panel = page.locator('[data-accordion-demo-panel="returns"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute(
    "aria-labelledby",
    (await returns.getAttribute("id")) ?? "",
  );

  const expandedHeight = await returnsFrame.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(expandedHeight).toBeGreaterThan(collapsedHeight + 20);
  await expect
    .poll(() => viewTransitionHeightKeyframes(page, "accordion-demo-returns"))
    .toEqual([collapsedHeight, expandedHeight]);

  expect(errors()).toEqual([]);
});

test("lets the browser own the radio group", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const group = page.locator("[data-radio-demo-root]");
  const standard = page.locator('[data-radio-demo-option="standard"]');
  const express = page.locator('[data-radio-demo-option="express"]');
  const overnight = page.locator('[data-radio-demo-option="overnight"]');

  await expect(group).toHaveAttribute("role", "radiogroup");
  await expect(standard).toBeChecked();
  // Real radios sharing a name, so submission and validity come for free.
  await expect(standard).toHaveAttribute("type", "radio");
  const name = await standard.getAttribute("name");
  expect(name).toBe(await overnight.getAttribute("name"));
  // The generated value is the identity's string form, and a caller's own
  // value prop wins over it.
  await expect(standard).toHaveValue("standard");
  await expect(overnight).toHaveValue("1-day");

  // The single tab stop, arrow movement on either axis, and wrapping are the
  // browser's, and the widget adds no keyboard handling at all.
  await standard.focus();
  await page.keyboard.press("ArrowRight");
  await expect(express).toBeChecked();
  await expect(express).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(overnight).toBeChecked();

  await page.keyboard.press("ArrowDown");
  await expect(standard).toBeChecked();

  // A user clicks the label, since the input itself is visually hidden.
  await page.locator('[data-radio-demo-label="overnight"]').click();
  await expect(overnight).toBeChecked();
  await expect(standard).not.toBeChecked();

  expect(errors()).toEqual([]);
});

test("opens a modal dialog the platform owns", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  const trigger = page.locator("[data-dialog-demo-trigger]");
  const dialog = page.locator("[data-dialog-demo]");
  const confirm = page.locator("[data-dialog-demo-confirm]");
  await expect(dialog).toBeHidden();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("open", "");

  // Locking the scroll would reflow the page as the scrollbar disappears, so
  // the gutter is reserved up front. The reflow itself cannot be observed
  // here — headless scrollbars are overlays and take no space — so this
  // asserts the declaration that prevents it.
  expect(await scrollbarGutter(page)).toBe("stable");

  // The user agent centres a modal dialog with `margin: auto`, which a CSS
  // reset takes away along with every other margin.
  const centred = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const room = element.ownerDocument.documentElement.clientWidth;
    // Half the leftover space, give or take the reserved gutter, which the
    // dialog is centred inside rather than across.
    return Math.abs(box.left - (room - box.width) / 2) < 12;
  });
  expect(centred).toBe(true);

  // showModal puts it in the top layer and moves focus inside.
  const inside = await dialog.evaluate((element) =>
    element.contains(element.ownerDocument.activeElement),
  );
  expect(inside).toBe(true);
  const labelled = await dialog.getAttribute("aria-labelledby");
  await expect(page.locator(`#${labelled}`)).toHaveText("Delete this file?");

  // The background is inert, so the trigger cannot be clicked through it.
  await expect(trigger).not.toBeFocused();
  const backgroundClickable = await trigger.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = element.ownerDocument.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return element.contains(hit);
  });
  expect(backgroundClickable).toBe(false);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The platform returns focus to whatever opened it.
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await confirm.click();
  await expect(dialog).toBeHidden();

  expect(errors()).toEqual([]);
});

test("anchors a popover the platform positions and dismisses", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const trigger = page.locator("[data-popover-demo-trigger]");
  const popover = page.locator("[data-popover-demo]");
  await expect(popover).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // The widget wires the pair with one generated anchor name.
  const names = await trigger.evaluate((element) => {
    const popoverElement = element.ownerDocument.querySelector<HTMLElement>(
      "[data-popover-demo]",
    );
    return {
      anchor: element.style.getPropertyValue("anchor-name"),
      target: element.getAttribute("popovertarget"),
      via: popoverElement?.style.getPropertyValue("position-anchor") ?? "",
    };
  });
  expect(names.anchor).toMatch(/^--fig-popover-/);
  expect(names.via).toBe(names.anchor);
  expect(names.target).toBe(await popover.getAttribute("id"));

  await trigger.click();
  await expect(popover).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // Anchor positioning placed it against the trigger without any measurement.
  // Which side depends on the room available, since the demo declares a
  // try-fallback, so adjacency is what separates anchoring from the centered
  // placement a top-layer popover takes by default.
  const geometry = await page.evaluate(() => {
    const trigger = document
      .querySelector("[data-popover-demo-trigger]")
      ?.getBoundingClientRect();
    const panel = document
      .querySelector("[data-popover-demo]")
      ?.getBoundingClientRect();
    return {
      gapAbove: Math.abs((trigger?.top ?? 0) - (panel?.bottom ?? 0)),
      gapBelow: Math.abs((panel?.top ?? 0) - (trigger?.bottom ?? 0)),
      supported: CSS.supports("position-area: block-end"),
    };
  });
  if (geometry.supported) {
    expect(Math.min(geometry.gapAbove, geometry.gapBelow)).toBeLessThan(24);
  }

  // Light dismiss is the platform's, not a listener the widget installed.
  await page.mouse.click(5, 5);
  await expect(popover).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  expect(errors()).toEqual([]);
});

test("coordinates tooltip, select, and combobox primitives", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const tooltipTrigger = page.locator("[data-tooltip-demo-trigger]");
  const tooltip = page.locator("[data-tooltip-demo]");
  await tooltipTrigger.focus();
  await expect(tooltip).toBeVisible();
  const tooltipId = await tooltip.getAttribute("id");
  if (tooltipId === null) throw new Error("Tooltip has no id");
  await expect(tooltipTrigger).toHaveAttribute("aria-describedby", tooltipId);
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();

  const selectTrigger = page.locator("[data-select-demo-trigger]");
  const selectPopup = page.locator("[data-select-demo]");
  await selectTrigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(selectPopup).toBeVisible();
  const bananaId = await page
    .locator('[data-select-demo-option="banana"]')
    .getAttribute("id");
  if (bananaId === null) throw new Error("Select option has no id");
  await expect(selectTrigger).toHaveAttribute(
    "aria-activedescendant",
    bananaId,
  );
  await page.keyboard.press("Enter");
  await expect(selectTrigger).toHaveText("banana");
  await expect(selectPopup).toBeHidden();

  const input = page.locator("[data-combobox-demo-input]");
  const comboboxPopup = page.locator("[data-combobox-demo]");
  await input.fill("bl");
  await expect(comboboxPopup).toBeVisible();
  await expect(page.locator("[data-combobox-demo-option]")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("blueberry");
  await expect(comboboxPopup).toBeHidden();

  expect(errors()).toEqual([]);
});

test("coordinates listbox, toolbar, and toast-region primitives", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const listbox = page.locator("[data-listbox-demo]");
  const apple = page.locator('[data-listbox-demo-option="apple"]');
  const banana = page.locator('[data-listbox-demo-option="banana"]');
  await expect(listbox).toHaveAttribute("role", "listbox");
  await expect(listbox).toHaveAttribute("aria-multiselectable", "true");
  await expect(apple).toHaveAttribute("aria-selected", "true");
  await listbox.focus();
  await page.keyboard.press("ArrowDown");
  await expect(listbox).toHaveAttribute(
    "aria-activedescendant",
    (await banana.getAttribute("id")) ?? "",
  );
  await expect(banana).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Space");
  await expect(banana).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-listbox-demo-value]")).toHaveText(
    "apple, banana",
  );

  const bold = page.locator('[data-toolbar-demo-item="bold"]');
  const italic = page.locator('[data-toolbar-demo-item="italic"]');
  const link = page.locator('[data-toolbar-demo-item="link"]');
  await expect(page.locator("[data-toolbar-demo]")).toHaveAttribute(
    "role",
    "toolbar",
  );
  await expect(bold).toHaveAttribute("tabindex", "0");
  await expect(italic).toBeDisabled();
  await bold.focus();
  await page.keyboard.press("ArrowRight");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-toolbar-demo-value]")).toHaveText("link");

  const region = page.locator("[data-toast-demo-region]");
  const firstToast = page.locator('[data-toast-demo="1"]');
  await expect(region).toHaveAttribute("role", "region");
  await expect(region).toHaveAttribute("aria-label", "Notifications");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(firstToast).toHaveAttribute("aria-atomic", "true");
  await page.locator('[data-toast-demo-dismiss="1"]').click();
  await expect(firstToast).toHaveCount(0);
  await page.locator("[data-toast-demo-add]").click();
  await expect(page.locator('[data-toast-demo="2"]')).toContainText(
    "Notification 2",
  );

  expect(errors()).toEqual([]);
});

test("opens a menu and gives it focus the platform does not", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const trigger = page.locator("[data-menu-demo-trigger]");
  const menu = page.locator("[data-menu-demo]");
  const rename = page.locator('[data-menu-demo-item="rename"]');
  const duplicate = page.locator('[data-menu-demo-item="duplicate"]');
  const remove = page.locator('[data-menu-demo-item="remove"]');
  const checkbox = page.locator("[data-menu-demo-checkbox]");
  const date = page.locator('[data-menu-demo-radio="date"]');
  const submenuTrigger = page.locator("[data-menu-demo-submenu-trigger]");
  const submenu = page.locator("[data-menu-demo-submenu]");
  const email = page.locator('[data-menu-demo-submenu-item="email"]');
  const chosen = page.locator("[data-menu-demo-chosen]");

  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(menu).toBeHidden();

  // showPopover leaves focus alone, so the menu moves it to the first item.
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(rename).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(duplicate).toBeFocused();

  // Typing jumps, and a disabled item stays reachable but inert.
  await page.keyboard.press("r");
  await expect(remove).toBeFocused();
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(chosen).toHaveText("none");

  await page.keyboard.press("ArrowDown");
  await expect(rename).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(chosen).toHaveText("rename");
  await expect(menu).toBeHidden();
  // Focus comes back to the trigger, which the platform does not do here.
  await expect(trigger).toBeFocused();

  // Checked items are controlled and remain open by default.
  await trigger.click();
  await checkbox.click();
  await expect(checkbox).toHaveAttribute("role", "menuitemcheckbox");
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(menu).toBeVisible();
  await date.click();
  await expect(date).toHaveAttribute("role", "menuitemradio");
  await expect(date).toHaveAttribute("aria-checked", "true");
  await expect(menu).toBeVisible();

  // Mouse intent uses a short delay and does not take keyboard focus.
  await submenuTrigger.hover();
  await expect(submenu).toBeVisible();
  await expect(date).toBeFocused();
  await rename.hover();
  await expect(submenu).toBeHidden();

  // The inline-end key enters a child menu and an action closes the tree.
  await submenuTrigger.focus();
  await page.keyboard.press("ArrowRight");
  await expect(submenu).toBeVisible();
  await expect(email).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chosen).toHaveText("email");
  await expect(submenu).toBeHidden();
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // Light dismiss still belongs to the popover underneath.
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();

  expect(errors()).toEqual([]);
});

test("wires a field around native form controls", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const label = page.locator("[data-form-demo-label]");
  const email = page.locator("[data-form-demo-email]");
  const hint = page.locator("[data-form-demo-hint]");
  const terms = page.locator("[data-form-demo-terms]");
  const notifications = page.locator("[data-form-demo-notifications]");
  const plan = page.locator("[data-form-demo-plan]");
  const result = page.locator("[data-form-demo-result]");

  // The field owns the relationships between the control and its text.
  const controlId = await email.getAttribute("id");
  expect(await label.getAttribute("for")).toBe(controlId);
  const hintId = await hint.getAttribute("id");
  if (hintId === null)
    throw new Error("Expected the field hint to have an id.");
  await expect(email).toHaveAttribute("aria-describedby", hintId);
  // Any value marks a boolean attribute present, so assert the property.
  await expect(email).toHaveJSProperty("required", true);

  // The switch is a checkbox the platform announces as on or off.
  await expect(notifications).toHaveAttribute("type", "checkbox");
  await expect(notifications).toHaveAttribute("role", "switch");
  await expect(notifications).toBeChecked();

  // Read-only is not disabled: it stays submitted and refuses interaction.
  await expect(plan).toHaveAttribute("aria-readonly", "true");
  await expect(plan).toBeEnabled();
  await plan.click();
  await expect(plan).toBeChecked();

  // Validity is the browser's: an empty required field blocks submission.
  await page.locator("[data-form-demo-submit]").click();
  await expect(result).toHaveText("nothing yet");

  await email.fill("someone@example.com");
  await terms.check();
  await notifications.uncheck();
  await page.locator("[data-form-demo-submit]").click();

  await expect(result).toHaveText(
    "email=someone@example.com terms=accepted plan=pro",
  );

  // Form reset restores each uncontrolled control's initial state.
  await page.locator("[data-form-demo-reset]").click();
  await expect(terms).not.toBeChecked();
  await expect(notifications).toBeChecked();
  await expect(plan).toBeChecked();

  expect(errors()).toEqual([]);
});

function scrollbarGutter(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.documentElement).scrollbarGutter,
  );
}

function tabsPanelAnimationNames(page: Page): Promise<string[]> {
  return page.locator("html").evaluate((element) =>
    element.getAnimations({ subtree: true }).flatMap((animation) => {
      const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
      if (pseudo?.includes("(tabs-demo-panel)") !== true) return [];
      const name = (animation as CSSAnimation).animationName;
      return name === "" ? [] : [name];
    }),
  );
}

function viewTransitionHeightKeyframes(
  page: Page,
  name: string,
): Promise<number[]> {
  return page.locator("html").evaluate(
    (element, transitionName) =>
      element.getAnimations({ subtree: true }).flatMap((animation) => {
        const effect = animation.effect;
        if (
          !(effect instanceof KeyframeEffect) ||
          effect.pseudoElement !== `::view-transition-group(${transitionName})`
        ) {
          return [];
        }
        return effect.getKeyframes().flatMap((keyframe) => {
          const height = Number.parseFloat(String(keyframe.height));
          return Number.isFinite(height) ? [height] : [];
        });
      }),
    name,
  );
}

function documentViewTransitionStarts(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __tabsDemoViewTransitionStarts: number;
        }
      ).__tabsDemoViewTransitionStarts,
  );
}

interface DocumentViewTransitionHost {
  startViewTransition?: (
    this: Document,
    options: { types?: string[]; update: () => void },
  ) => ViewTransition;
}

test("themes card surfaces in dark mode", async ({ context, page }) => {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "fig-demo-theme",
      path: "/",
      value: "dark",
    },
  ]);

  await page.goto("/asset-lab");
  await expect(page.locator("[data-asset-lab]")).toHaveCSS(
    "background-color",
    "rgb(24, 36, 45)",
  );
  await expect(
    page.getByRole("button", { name: /Client asset island/ }),
  ).toHaveCSS("background-color", "rgb(24, 36, 45)");

  await page.getByRole("link", { name: "Transitions" }).click();
  await expect(page.locator("main article")).toHaveCSS(
    "background-color",
    "rgb(24, 36, 45)",
  );
  await expect(page.locator("main aside")).toHaveCSS(
    "background-color",
    "rgb(24, 36, 45)",
  );
});

test("renders and refreshes isomorphic and remote data resources", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const serverFunctionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-tsr-serverfn"] === "true") {
      serverFunctionRequests.push(request.url());
    }
  });

  await page.goto("/data", { waitUntil: "commit" });
  const isomorphic = page.locator('[data-data-value="Isomorphic"]');
  const remote = page.locator('[data-data-value="Remote server"]');
  await expect(isomorphic).toContainText("Hello Fig · server");
  await expect(remote).toContainText("Adapter-first routing · server-remote");
  expect(serverFunctionRequests).toEqual([]);

  await page.getByRole("button", { name: "Refresh isomorphic" }).click();
  await expect(isomorphic).toContainText("Hello Fig · browser · load 1");
  expect(serverFunctionRequests).toEqual([]);

  const remoteBefore = await remote.textContent();
  await page.getByRole("button", { name: "Refresh remote" }).click();
  await expect(remote).not.toHaveText(remoteBefore ?? "");
  expect(serverFunctionRequests).toHaveLength(1);

  await page
    .getByRole("link", { name: "Open server-only post Payload" })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Hello Fig" }),
  ).toBeVisible();
  await expect(page.locator("[data-server-post]")).toContainText(
    "server-only Payload resource",
  );
  expect(serverFunctionRequests).toHaveLength(2);
  expect(errors()).toEqual([]);
});

test("commits a nonblocking payload route without publishing stale UI", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await page.getByRole("link", { name: "Assets" }).click();
  await expect(page).toHaveURL(/\/asset-lab$/);
  await expect(page.locator("[data-asset-lab-pending]")).toBeVisible();

  await page.getByRole("link", { name: "Data" }).click();
  await expect(page.getByRole("heading", { name: "Data lab" })).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.locator("[data-asset-lab]")).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test("adopts two embedded Payload resources and hydrates the asset island", async ({
  page,
  request,
}) => {
  const response = await request.get("/asset-lab");
  const html = await response.text();
  const assetSegment = '<section class="asset-lab-root" data-asset-lab';
  expect(html.match(/data-fig-tanstack-payload-key/g)).toHaveLength(2);
  expect(html).toContain(assetSegment);
  expect(html.indexOf('data-precedence="payload"')).toBeLessThan(
    html.indexOf(assetSegment),
  );
  expect(html.indexOf('data-precedence="isomorphic"')).toBeLessThan(
    html.indexOf(assetSegment),
  );
  expect(html).toMatch(/href="\/assets\/AssetLabIsland-[^"]+\.css"/);

  const payloadImageHref = tagAssetUrl(html, "img", "data-payload-image");
  expect(payloadImageHref).toMatch(/^\/assets\/payload-mark-[^/]+\.svg$/);
  const payloadStylesheetHref = tagAssetUrl(
    html,
    "link",
    'data-precedence="payload"',
    "asset-lab-",
  );
  const stylesheetResponse = await request.get(payloadStylesheetHref);
  expect(stylesheetResponse.ok()).toBe(true);
  expect(stylesheetResponse.headers()["content-type"]).toMatch(/^text\/css/);
  const stylesheet = await stylesheetResponse.text();
  const stylesheetAssetHrefs = [...stylesheet.matchAll(/url\(["']?([^"')]+)/g)]
    .map((match) => match[1])
    .filter((href): href is string => href?.includes("/payload-") === true);
  const payloadFontHref = stylesheetAssetHrefs.find((href) =>
    /^\/assets\/payload-font-[^/]+\.woff2$/.test(href),
  );
  const payloadBackgroundHref = stylesheetAssetHrefs.find((href) =>
    /^\/assets\/payload-background-[^/]+\.svg$/.test(href),
  );
  expect(payloadFontHref).toBeDefined();
  expect(payloadBackgroundHref).toBeDefined();
  if (payloadFontHref === undefined || payloadBackgroundHref === undefined) {
    throw new Error("Expected emitted font and background-image asset URLs.");
  }

  const emittedAssets = [
    payloadImageHref,
    payloadFontHref,
    payloadBackgroundHref,
  ];
  const emittedResponses = await Promise.all(
    emittedAssets.map((href) => request.get(href)),
  );
  expect(emittedResponses.every((asset) => asset.ok())).toBe(true);
  expect(
    emittedResponses.map((asset) => asset.headers()["content-type"]),
  ).toEqual([
    expect.stringMatching(/^image\/svg\+xml/),
    expect.stringMatching(/^font\/woff2/),
    expect.stringMatching(/^image\/svg\+xml/),
  ]);

  const errors = collectBrowserErrors(page);
  const serverFunctionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-tsr-serverfn"] === "true") {
      serverFunctionRequests.push(request.url());
    }
  });
  await page.goto("/asset-lab");

  await expect(page.locator("[data-asset-lab]")).toBeVisible();
  await expect(page.locator("[data-asset-note]")).toBeVisible();
  expect(serverFunctionRequests).toEqual([]);
  const island = page.getByRole("button", { name: /Client asset island/ });
  await expect(island).toContainText("clicks: 0");
  await island.click();
  await expect(island).toContainText("clicks: 1");
  expect(errors()).toEqual([]);
});

test("navigates nested, split, and not-found routes", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page.locator("[data-split-route]")).toBeVisible();
  await expect(page).toHaveTitle("About · Fig TanStack Start");

  await page.getByRole("link", { name: "Posts" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Posts" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Streaming data" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Streaming data" }),
  ).toBeVisible();
  expect(errors()).toEqual([]);

  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { level: 1, name: "404" }),
  ).toBeVisible();
});

function tagAssetUrl(
  markup: string,
  tagName: "img" | "link",
  marker: string,
  urlMarker?: string,
): string {
  const attribute = tagName === "img" ? "src" : "href";
  const tag = [...markup.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "g"))]
    .map((match) => match[0])
    .find(
      (candidate) =>
        candidate.includes(marker) &&
        (urlMarker === undefined || candidate.includes(urlMarker)),
    );
  const url = tag?.match(new RegExp(`\\s${attribute}="([^"]+)"`))?.[1];
  if (url === undefined) {
    throw new Error(
      `Expected a ${tagName} with ${marker} and a ${attribute} asset URL.`,
    );
  }
  return url;
}

test("morphs the homepage link into the view-transition title", async ({
  page,
}) => {
  await page.addInitScript(() => {
    interface Surface {
      marker: string;
      name: string;
      tag: string;
    }
    interface Snapshot {
      after: Surface[];
      before: Surface[];
    }
    const state = window as Window & {
      __viewTransitionSnapshots?: Snapshot[];
    };
    const collect = (): Surface[] =>
      Array.from(document.querySelectorAll<HTMLElement>("*")).flatMap(
        (element) => {
          const name = element.style.viewTransitionName;
          return name.length === 0 || name === "none"
            ? []
            : [
                {
                  marker: element.dataset.viewTransitionSurface ?? "",
                  name,
                  tag: element.tagName.toLowerCase(),
                },
              ];
        },
      );
    state.__viewTransitionSnapshots = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void | Promise<void>) => {
        const before = collect();
        const finished = Promise.resolve(update()).then(() => {
          state.__viewTransitionSnapshots?.push({ after: collect(), before });
        });
        return { finished, ready: Promise.resolve() };
      },
    });
  });

  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "View transitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();
  const snapshots = await page.evaluate(
    () =>
      (
        window as Window & {
          __viewTransitionSnapshots?: Array<{
            after: Array<{ marker: string; name: string; tag: string }>;
            before: Array<{ marker: string; name: string; tag: string }>;
          }>;
        }
      ).__viewTransitionSnapshots ?? [],
  );
  expect(snapshots).toContainEqual({
    after: expect.arrayContaining([
      {
        marker: "page-title",
        name: "start-vt-page-title",
        tag: "span",
      },
    ]),
    before: expect.arrayContaining([
      {
        marker: "home-link",
        name: "start-vt-page-title",
        tag: "span",
      },
    ]),
  });
  expect(errors()).toEqual([]);
});

test("does not leak a skipped homepage view transition", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "View transitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();
  await page.waitForTimeout(100);
  expect(errors()).toEqual([]);
});

test("animates the shared homepage title surface in Chromium", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document);
    if (original === undefined) return;
    const state = window as Window & {
      __nativeViewTransitionPseudos?: Promise<string[]>;
      __nativeViewTransitionStarts?: number;
    };
    state.__nativeViewTransitionStarts = 0;
    document.startViewTransition = (update) => {
      state.__nativeViewTransitionStarts =
        (state.__nativeViewTransitionStarts ?? 0) + 1;
      const transition = original(update);
      state.__nativeViewTransitionPseudos = transition.ready.then(() =>
        document.getAnimations().flatMap((animation) => {
          const pseudo = (animation.effect as KeyframeEffect | null)
            ?.pseudoElement;
          return pseudo === null || pseudo === undefined ? [] : [pseudo];
        }),
      );
      return transition;
    };
  });
  await page.goto("/");
  expect(await page.evaluate(() => typeof document.startViewTransition)).toBe(
    "function",
  );
  await page.getByRole("link", { name: "View transitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();

  const pseudos = await page.evaluate(
    () =>
      (
        window as Window & {
          __nativeViewTransitionPseudos?: Promise<string[]>;
        }
      ).__nativeViewTransitionPseudos,
  );
  expect(pseudos).toContain("::view-transition-group(start-vt-page-title)");
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __nativeViewTransitionStarts?: number;
          }
        ).__nativeViewTransitionStarts,
    ),
  ).toBe(1);
});
