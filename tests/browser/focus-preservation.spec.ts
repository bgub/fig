import { expect, test } from "@playwright/test";
import { build } from "tsdown";
import {
  figSourceAliases,
  workspacePath,
} from "../../scripts/lib/fig-source-aliases.ts";
import type {} from "./fixtures/focus.ts";

let fixture: string;
let browserErrors: string[] = [];

test.beforeAll(async () => {
  const [bundle] = await build({
    config: false,
    entry: [workspacePath("tests/browser/fixtures/focus.ts")],
    alias: figSourceAliases(),
    define: {
      __FIG_DEV__: String(test.info().project.name.endsWith("development")),
    },
    deps: { alwaysBundle: [/^@bgub\/fig/] },
    format: "iife",
    platform: "browser",
    dts: false,
    write: false,
    clean: false,
    logLevel: "silent",
  });
  try {
    expect(bundle.chunks).toHaveLength(1);
    const chunk = bundle.chunks[0];
    if (chunk.type !== "chunk")
      throw new Error("Expected a JavaScript fixture bundle.");
    fixture = chunk.code;
  } finally {
    await bundle[Symbol.asyncDispose]();
  }
});

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setContent(
    '<div style="height:1200px"></div><div id="root"></div><div style="height:1200px"></div>',
  );
  await page.addScriptTag({ content: fixture });
});

test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

for (const fallback of [false, true]) {
  for (const ancestor of [false, true]) {
    for (const kind of ["input", "textarea", "contenteditable"] as const) {
      for (const direction of ["forward", "backward"] as const) {
        test(`preserves ${direction} ${kind} selection during ${ancestor ? "ancestor" : "host"} reorder (${fallback ? "fallback" : "native"})`, async ({
          page,
        }) => {
          await page.evaluate(
            ({ kind, ancestor, fallback }) => {
              window.focusFixture.mount(kind, ancestor, fallback);
            },
            { kind, ancestor, fallback },
          );
          const editor = page.locator("#editor");
          const original = await editor.elementHandle();
          await editor.focus();
          const scrollBefore = await page.evaluate(
            ({ kind, direction }) => {
              const element = document.getElementById("editor")!;
              if (kind === "contenteditable") {
                const [anchor, focus] =
                  direction === "forward" ? [2, 8] : [8, 2];
                document
                  .getSelection()!
                  .setBaseAndExtent(
                    element.firstChild!,
                    anchor,
                    element.firstChild!,
                    focus,
                  );
              } else {
                (
                  element as HTMLInputElement | HTMLTextAreaElement
                ).setSelectionRange(2, 8, direction);
              }
              return window.scrollY;
            },
            { kind, direction },
          );

          await page.evaluate(() => window.focusFixture.reverse());

          await expect(page.locator("#list > :first-child")).toHaveAttribute(
            "data-key",
            "other",
          );
          expect(
            await original!.evaluate(
              (element) => element === document.getElementById("editor"),
            ),
          ).toBe(true);
          await expect(editor).toBeFocused();
          expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
          expect(
            await page.evaluate(() => window.focusFixture.nativeMoves()),
          ).toBe(fallback ? 0 : 1);
          if (kind === "contenteditable") {
            expect(
              await page.evaluate(() => {
                const selection = document.getSelection()!;
                const text = document.getElementById("editor")!.firstChild;
                return {
                  text: selection.toString(),
                  anchor: selection.anchorOffset,
                  focus: selection.focusOffset,
                  sameNodes:
                    selection.anchorNode === text &&
                    selection.focusNode === text,
                };
              }),
            ).toEqual({
              text: "lected",
              anchor: direction === "forward" ? 2 : 8,
              focus: direction === "forward" ? 8 : 2,
              sameNodes: true,
            });
          } else {
            expect(
              await editor.evaluate(
                (element: HTMLInputElement | HTMLTextAreaElement) => ({
                  start: element.selectionStart,
                  end: element.selectionEnd,
                  direction: element.selectionDirection,
                }),
              ),
            ).toEqual({ start: 2, end: 8, direction });
          }
        });
      }
    }
  }
}

test("fallback respects focus chosen by a native blur handler", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.focusFixture.mount("input", true, true);
    const editor = document.getElementById("editor")!;
    editor.focus();
    editor.addEventListener("blur", () =>
      document.getElementById("other")!.focus(),
    );
    window.focusFixture.reverse();
  });
  await expect(page.locator("#other")).toBeFocused();
});

for (const change of [
  "caret",
  "backward",
  "outside",
  "clear",
  "range",
  "unchanged",
] as const) {
  test(`native reordering respects custom-element selection (${change})`, async ({
    page,
  }) => {
    const result = await page.evaluate((change) => {
      let callbacks = 0;
      const selectionState = () => {
        const selection = document.getSelection()!;
        return {
          anchor: selection.anchorOffset,
          focus: selection.focusOffset,
          anchorParent: selection.anchorNode?.parentElement?.id ?? null,
          focusParent: selection.focusNode?.parentElement?.id ?? null,
          rangeCount: selection.rangeCount,
        };
      };
      let chosen: ReturnType<typeof selectionState> | undefined;
      customElements.define(
        "move-editor",
        class extends HTMLElement {
          connectedMoveCallback() {
            callbacks += 1;
            const selection = document.getSelection()!;
            const text = document.getElementById("editor")!.firstChild!;
            switch (change) {
              case "caret":
                selection.collapse(text, 4);
                break;
              case "backward":
                selection.setBaseAndExtent(text, 9, text, 3);
                break;
              case "outside": {
                const other = document.getElementById("other")!.firstChild!;
                selection.setBaseAndExtent(other, 1, other, 4);
                break;
              }
              case "clear":
                selection.removeAllRanges();
                break;
              case "range": {
                const range = selection.getRangeAt(0);
                range.setStart(text, 4);
                range.setEnd(text, 7);
                break;
              }
            }
            // Chromium can normalize clear/outside selections while the editor
            // is focused. Preserve the native callback result in either case.
            if (change !== "unchanged") chosen = selectionState();
          }
        },
      );
      window.focusFixture.mount("contenteditable", "custom", false);
      const editor = document.getElementById("editor")!;
      editor.focus();
      const selection = document.getSelection()!;
      selection.setBaseAndExtent(editor.firstChild!, 2, editor.firstChild!, 8);
      const initial = selectionState();
      window.focusFixture.reverse();
      return {
        callbacks,
        moves: window.focusFixture.nativeMoves(),
        initial,
        expected: chosen ?? initial,
        actual: selectionState(),
      };
    }, change);
    expect(result.callbacks).toBe(1);
    expect(result.moves).toBe(1);
    if (change !== "unchanged")
      expect(result.expected).not.toEqual(result.initial);
    expect(result.actual).toEqual(result.expected);
    await expect(page.locator("#editor")).toBeFocused();
  });
}

for (const kind of ["dialog", "popover"] as const) {
  test(`native reordering preserves ${kind} top-layer state`, async ({
    page,
  }) => {
    expect(
      await page.evaluate((kind) => {
        window.focusFixture.mount(kind, true, false);
        const element = document.getElementById("editor")!;
        if (kind === "dialog") (element as HTMLDialogElement).showModal();
        else element.showPopover();
        const focused = document.activeElement;
        window.focusFixture.reverse();
        return {
          open: element.matches(kind === "dialog" ? ":modal" : ":popover-open"),
          focusPreserved: document.activeElement === focused,
          moves: window.focusFixture.nativeMoves(),
        };
      }, kind),
    ).toEqual({ open: true, focusPreserved: true, moves: 1 });
  });
}
