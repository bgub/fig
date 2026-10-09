import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import type { PopupPositionOptions } from "../../packages/fig-headless/src/popup/position.ts";
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
          new URL("./fixtures/popup-position.tsx", import.meta.url),
        ),
        name: "PositionFixture",
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
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setContent(`<style>
    body { margin: 0; }
    [data-container] { position: absolute; left: 300px; top: 250px; width: 200px; height: 100px; }
    [data-anchor] { display: block; width: 80px; height: 40px; padding: 0; border: 0; }
    [data-popup] { width: 160px; padding: 0; border: 0; }
    [data-content] { height: 100px; }
  </style><div id="fixture"></div>`);
  await page.addScriptTag({ content: fixture });
});

async function configure(
  page: Page,
  options: Partial<PopupPositionOptions> = {},
) {
  await page.evaluate((options) => {
    document.dispatchEvent(
      new CustomEvent("position-options", {
        detail: { open: true, ...options },
      }),
    );
  }, options);
  if (options.open !== false)
    await expect(page.locator("[data-popup]")).toBeVisible();
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>("[data-anchor]")!;
    const popup = document.querySelector<HTMLElement>("[data-popup]")!;
    const a = anchor.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    const css = getComputedStyle(popup);
    return {
      a: {
        x: a.x,
        y: a.y,
        width: a.width,
        height: a.height,
        right: a.right,
        bottom: a.bottom,
      },
      p: {
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        right: p.right,
        bottom: p.bottom,
      },
      side: popup.dataset.side,
      align: popup.dataset.align,
      anchorWidth: css.getPropertyValue("--anchor-width"),
      anchorHeight: css.getPropertyValue("--anchor-height"),
      availableWidth: parseFloat(css.getPropertyValue("--available-width")),
      availableHeight: parseFloat(css.getPropertyValue("--available-height")),
      origin: css.getPropertyValue("--transform-origin"),
    };
  });
}

for (const direction of ["ltr", "rtl"] as const) {
  for (const side of [
    "top",
    "bottom",
    "left",
    "right",
    "inline-start",
    "inline-end",
  ] as const) {
    test(`${direction} ${side}: alignments, offsets, and placement metadata`, async ({
      page,
    }) => {
      const errors = collectBrowserErrors(page);
      await page
        .locator("html")
        .evaluate((node, dir) => node.setAttribute("dir", dir), direction);
      const physical =
        side === "inline-start"
          ? direction === "rtl"
            ? "right"
            : "left"
          : side === "inline-end"
            ? direction === "rtl"
              ? "left"
              : "right"
            : side;
      const vertical = physical === "top" || physical === "bottom";
      for (const align of ["start", "center", "end"] as const) {
        await configure(page, { side, align, sideOffset: 12, alignOffset: 7 });
        const { a, p, ...state } = await geometry(page);
        expect(state.side).toBe(side);
        expect(state.align).toBe(align);
        expect(state.anchorWidth).toBe("80px");
        expect(state.anchorHeight).toBe("40px");
        const distance =
          physical === "top"
            ? a.y - p.bottom
            : physical === "bottom"
              ? p.y - a.bottom
              : physical === "left"
                ? a.x - p.right
                : p.x - a.right;
        expect(distance).toBeCloseTo(12);
        const reverse = vertical && direction === "rtl";
        const start = vertical ? a.x : a.y;
        const end = vertical ? a.right : a.bottom;
        const size = vertical ? p.width : p.height;
        const expected =
          align === "center"
            ? (start + end - size) / 2
            : (align === "end") !== reverse
              ? end - size
              : start;
        const offset = 7 * (align === "end" ? -1 : 1) * (reverse ? -1 : 1);
        expect(vertical ? p.x : p.y).toBeCloseTo(expected + offset);
        expect(state.origin).not.toBe("");
      }
      expect(errors()).toEqual([]);
    });
  }
}

test("flips, shifts, and reports available space with a custom viewport gutter", async ({
  page,
}) => {
  await page.addStyleTag({
    content: "[data-container] {left:740px;top:550px}",
  });
  await configure(page, { side: "bottom", collisionPadding: 20 });
  const { p, ...state } = await geometry(page);
  expect(state.side).toBe("top");
  expect(p.right).toBe(780);
  expect(p.bottom).toBe(546);
  expect(state.availableWidth).toBe(760);
  expect(state.availableHeight).toBe(526);
  expect(state.origin).toBe("160px 104px");
});

test("preserves authored max sizes, updates them, and restores them on detach", async ({
  page,
}) => {
  await page.addStyleTag({
    content: "[data-popup] {max-width:120px;max-height:60px}",
  });
  await configure(page);
  let state = await geometry(page);
  expect(state.p.width).toBe(120);
  expect(state.p.height).toBe(60);
  await page.locator("[data-popup]").evaluate((node) => {
    node.style.maxWidth = "90px";
    node.style.maxHeight = "40px";
  });
  await expect.poll(async () => (await geometry(page)).p.width).toBe(90);
  await configure(page, { sideOffset: 8 });
  state = await geometry(page);
  expect(state.p.height).toBe(40);
  expect(state.p.width).toBe(90);
  const restored = await page.evaluate(() => {
    const popup = document.querySelector<HTMLElement>("[data-popup]")!;
    document.dispatchEvent(new Event("position-unmount"));
    return {
      width: popup.style.maxWidth,
      height: popup.style.maxHeight,
      side: popup.getAttribute("data-side"),
      variable: popup.style.getPropertyValue("--anchor-width"),
    };
  });
  expect(restored).toEqual({
    width: "90px",
    height: "40px",
    side: null,
    variable: "",
  });
});

test("CSS can consume anchor and available size variables", async ({
  page,
}) => {
  await page.addStyleTag({
    content:
      "[data-popup] {width:var(--anchor-width);max-height:min(80px,var(--available-height))}",
  });
  await configure(page);
  expect((await geometry(page)).p.width).toBe(80);
  expect((await geometry(page)).p.height).toBe(80);
});

for (const movement of ["layout", "transform", "clipped layout"] as const) {
  test(`tracks ${movement} with unchanged ancestor sizes`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    if (movement === "clipped layout")
      await page.addStyleTag({
        content: "[data-container] {width:60px;overflow:hidden}",
      });
    await configure(page);
    await expect.poll(async () => (await geometry(page)).p.x).toBe(300);
    await page.locator("[data-anchor]").evaluate((node, movement) => {
      if (movement === "transform")
        node.style.transform = "translate(30px, 20px)";
      else node.style.marginLeft = "30px";
    }, movement);
    await expect
      .poll(async () => {
        const { a, p } = await geometry(page);
        return { x: p.x - a.x, gap: p.y - a.bottom };
      })
      .toEqual({ x: 0, gap: 4 });
    expect(errors()).toEqual([]);
  });
}

test("tracks animated anchor transforms when requested", async ({ page }) => {
  await configure(page, { trackAnchorAnimation: true });
  await page.locator("[data-anchor]").evaluate((node) => {
    const animation = node.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(80px)" }],
      { duration: 1000, fill: "forwards" },
    );
    animation.pause();
    animation.currentTime = 500;
  });
  await expect.poll(async () => (await geometry(page)).p.x).toBe(340);
  await page.locator("[data-anchor]").evaluate((node) => {
    node.getAnimations()[0]!.currentTime = 900;
  });
  await expect.poll(async () => (await geometry(page)).p.x).toBe(372);
});

test("reports a fully clipped anchor and clears the state when it returns", async ({
  page,
}) => {
  await page.addStyleTag({ content: "[data-container] {overflow:hidden}" });
  await configure(page);
  const popup = page.locator("[data-popup]");
  await expect(popup).not.toHaveAttribute("data-anchor-hidden");
  await page.locator("[data-anchor]").evaluate((node) => {
    node.style.marginTop = "120px";
  });
  await expect(popup).toHaveAttribute("data-anchor-hidden", "");
  await page.locator("[data-anchor]").evaluate((node) => {
    node.style.marginTop = "20px";
  });
  await expect(popup).not.toHaveAttribute("data-anchor-hidden");
  await expect.poll(async () => (await geometry(page)).p.y).toBe(314);
});

test("negative side offsets overlap the anchor", async ({ page }) => {
  await configure(page, { sideOffset: -8 });
  expect((await geometry(page)).p.y).toBe(282);
});

test("movement tracking remains accurate after the viewport grows", async ({
  page,
}) => {
  await configure(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  // Let resize processing rebuild the observation region before moving.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.locator("[data-anchor]").evaluate((node) => {
    node.style.marginLeft = "50px";
  });
  await expect.poll(async () => (await geometry(page)).p.x).toBe(350);
});

test("oversized content remains viewport bounded when its anchor is outside", async ({
  page,
}) => {
  await page.addStyleTag({
    content: "[data-container] {top:900px} [data-content] {height:900px}",
  });
  await configure(page);
  const { p, availableHeight } = await geometry(page);
  expect(p.y).toBeGreaterThanOrEqual(4);
  expect(p.bottom).toBeLessThanOrEqual(596);
  expect(availableHeight).toBeLessThanOrEqual(592);
  await expect(page.locator("[data-popup]")).toHaveAttribute(
    "data-anchor-hidden",
    "",
  );
});

test("movement tracking follows an anchor after it shrinks", async ({
  page,
}) => {
  await configure(page);
  const anchor = page.locator("[data-anchor]");
  await anchor.evaluate((node) => {
    node.style.width = "40px";
  });
  await expect
    .poll(async () => (await geometry(page)).anchorWidth)
    .toBe("40px");
  await anchor.evaluate((node) => {
    node.style.marginLeft = "20px";
  });
  await expect.poll(async () => (await geometry(page)).p.x).toBe(320);
});

test("movement tracking handles fractional anchor bounds", async ({ page }) => {
  await page.addStyleTag({
    content:
      "[data-container] {left:300.3px;top:250.7px} [data-anchor] {width:80.2px;height:39.6px}",
  });
  await configure(page);
  // Wait for observer delivery before shifting within unchanged ancestors.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.locator("[data-anchor]").evaluate((node) => {
    node.style.marginLeft = "20px";
  });
  await expect
    .poll(async () => {
      const { a, p } = await geometry(page);
      return Math.abs(a.x - p.x);
    })
    .toBeLessThan(0.1);
});

test("logical placement metadata follows flips and vertical fallbacks", async ({
  page,
}) => {
  await page.addStyleTag({
    content: "[data-container] {left:660px;top:250px}",
  });
  await configure(page, { side: "inline-end" });
  await expect(page.locator("[data-popup]")).toHaveAttribute(
    "data-side",
    "inline-start",
  );
  await page.setViewportSize({ width: 320, height: 600 });
  await page.locator("[data-container]").evaluate((node) => {
    node.style.left = "100px";
  });
  await expect(page.locator("[data-popup]")).toHaveAttribute(
    "data-side",
    "bottom",
  );
});

test("remeasuring a constrained popup preserves its scroll position", async ({
  page,
}) => {
  await page.addStyleTag({ content: "[data-content] {height:1000px}" });
  await configure(page);
  const popup = page.locator("[data-popup]");
  await popup.evaluate((node) => {
    node.scrollTop = 650;
  });
  // Force unrelated measurements after scrolling beyond the temporary
  // full-viewport measurement height's scroll range.
  await page.setViewportSize({ width: 801, height: 600 });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(650);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await popup.evaluate((node) => node.scrollTop)).toBe(650);
});
