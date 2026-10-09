import { expect, test, type Page } from "@playwright/test";
import { build } from "tsdown";
import {
  figSourceAliases,
  workspacePath,
} from "../../scripts/lib/fig-source-aliases.ts";
import type {} from "./fixtures/focus.ts";

let fixture: string;
let browserErrors: string[] = [];

async function requireAtomicMoves(page: Page): Promise<void> {
  test.skip(
    await page.evaluate(
      () => typeof Element.prototype.moveBefore !== "function",
    ),
    "This browser does not implement native atomic moves.",
  );
}

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
          if (!fallback) await requireAtomicMoves(page);
          await page.evaluate(
            ({ kind, ancestor, fallback }) => {
              window.focusFixture.mount(kind, ancestor, fallback);
            },
            { kind, ancestor, fallback },
          );
          const editor = page.locator("#editor");
          const original = await editor.elementHandle();
          // Start onscreen so a delayed initial focus scroll cannot be mistaken
          // for scrolling caused by the later reorder (notably in WebKit).
          await editor.scrollIntoViewIfNeeded();
          await editor.focus();
          const scrollBefore = await page.evaluate(
            async ({ kind, direction }) => {
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
              await new Promise(requestAnimationFrame);
              await new Promise(requestAnimationFrame);
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

for (const fallback of [false, true]) {
  for (const change of ["focus", "blur", "clear", "caret"] as const) {
    test(`restores the commit snapshot after mutation callbacks (${change}, ${fallback ? "fallback" : "native"})`, async ({
      page,
    }) => {
      if (!fallback) await requireAtomicMoves(page);
      const result = await page.evaluate(
        ({ fallback, change }) => {
          let moving = false;
          let callbacks = 0;
          const changeState = () => {
            if (!moving) return;
            callbacks++;
            const editor = document.getElementById("editor")!;
            if (change === "focus") document.getElementById("other")!.focus();
            else if (change === "blur") {
              editor.focus();
              editor.blur();
            } else if (change === "clear")
              document.getSelection()!.removeAllRanges();
            else document.getSelection()!.collapse(editor.firstChild!, 4);
          };
          customElements.define(
            "move-editor",
            class extends HTMLElement {
              connectedCallback() {
                if (fallback) changeState();
              }
              connectedMoveCallback() {
                changeState();
              }
            },
          );
          window.focusFixture.mount("contenteditable", "custom", fallback);
          const editor = document.getElementById("editor")!;
          editor.focus();
          document
            .getSelection()!
            .setBaseAndExtent(editor.firstChild!, 8, editor.firstChild!, 2);
          moving = true;
          window.focusFixture.reverse();
          const selection = document.getSelection()!;
          return {
            callbacks,
            focused: document.activeElement === editor,
            anchor: selection.anchorOffset,
            focus: selection.focusOffset,
            text: selection.toString(),
          };
        },
        { fallback, change },
      );
      expect(result).toEqual({
        callbacks: 1,
        focused: true,
        anchor: 8,
        focus: 2,
        text: "lected",
      });
    });
  }
  for (const policy of ["focus", "blur", "clear", "caret"] as const) {
    test(`component before-paint ${policy} policy runs after restoration (${fallback ? "fallback" : "native"})`, async ({
      page,
    }) => {
      if (!fallback) await requireAtomicMoves(page);
      const result = await page.evaluate(
        ({ fallback, policy }) => {
          window.focusFixture.mount("contenteditable", true, fallback);
          const editor = document.getElementById("editor")!;
          const selection = document.getSelection()!;
          editor.focus();
          selection.setBaseAndExtent(
            editor.firstChild!,
            8,
            editor.firstChild!,
            2,
          );
          let restored = false;
          window.focusFixture.beforePaint = () => {
            restored =
              document.activeElement === editor &&
              selection.anchorOffset === 8 &&
              selection.focusOffset === 2;
            if (policy === "focus") document.getElementById("other")!.focus();
            else if (policy === "blur") editor.blur();
            else if (policy === "clear") selection.removeAllRanges();
            else selection.collapse(editor.firstChild!, 4);
          };
          window.focusFixture.reverse();
          return {
            restored,
            active: document.activeElement?.id,
            count: selection.rangeCount,
            anchor: selection.anchorOffset,
            focus: selection.focusOffset,
          };
        },
        { fallback, policy },
      );
      expect(result.restored).toBe(true);
      if (policy === "focus") expect(result.active).toBe("other");
      else if (policy === "blur") expect(result.active).toBe("");
      else if (policy === "clear") expect(result.count).toBe(0);
      else expect([result.anchor, result.focus]).toEqual([4, 4]);
    });
  }
  test(`selection repair keeps the focused descendant of an editing host (${fallback ? "fallback" : "native"})`, async ({
    page,
  }) => {
    if (!fallback) await requireAtomicMoves(page);
    const result = await page.evaluate((fallback) => {
      window.focusFixture.mount("contenteditable", true, fallback);
      const editor = document.getElementById("editor")!;
      editor.removeAttribute("contenteditable");
      editor.tabIndex = 0;
      editor.parentElement!.contentEditable = "true";
      const selection = document.getSelection()!;
      selection.setBaseAndExtent(editor.firstChild!, 8, editor.firstChild!, 2);
      editor.focus();
      window.focusFixture.reverse();
      return {
        focused: document.activeElement === editor,
        anchor: selection.anchorOffset,
        focus: selection.focusOffset,
      };
    }, fallback);
    expect(result).toEqual({ focused: true, anchor: 8, focus: 2 });
  });
}

for (const action of ["remove", "hide"] as const) {
  test(`does not restore focus or selection into a ${action === "remove" ? "deleted" : "hidden"} editor`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (action) => {
      window.focusFixture.mount("contenteditable", true, true);
      const editor = document.getElementById("editor")!;
      editor.focus();
      document
        .getSelection()!
        .setBaseAndExtent(editor.firstChild!, 2, editor.firstChild!, 8);
      let restores = 0;
      const focus = editor.focus.bind(editor);
      editor.focus = (options) => {
        restores++;
        focus(options);
      };
      const selection = document.getSelection()!;
      const select = selection.setBaseAndExtent.bind(selection);
      selection.setBaseAndExtent = (...args) => {
        restores++;
        select(...args);
      };
      window.focusFixture[action]();
      await new Promise(requestAnimationFrame);
      return { restores, visible: editor.checkVisibility() };
    }, action);
    expect(result).toEqual({ restores: 0, visible: false });
  });
}

for (const kind of ["dialog", "popover"] as const) {
  test(`native reordering preserves ${kind} top-layer state`, async ({
    page,
  }) => {
    await requireAtomicMoves(page);
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

for (const mode of ["open", "closed"] as const) {
  for (const fallback of [false, true]) {
    for (const kind of ["input", "contenteditable"] as const) {
      test(`preserves ${mode} shadow-root ${kind} focus and selection (${fallback ? "fallback" : "native"})`, async ({
        page,
      }) => {
        if (!fallback) await requireAtomicMoves(page);
        const result = await page.evaluate(
          ({ fallback, kind, mode }) => {
            const shadow = document
              .getElementById("root")!
              .attachShadow({ mode });
            window.focusFixture.mount(kind, true, fallback, shadow);
            const editor = shadow.querySelector<HTMLElement>("#editor")!;
            editor.focus();
            const selection = document.getSelection()!;
            if (kind === "input")
              (editor as HTMLInputElement).setSelectionRange(2, 8, "backward");
            else
              selection.setBaseAndExtent(
                editor.firstChild!,
                8,
                editor.firstChild!,
                2,
              );
            window.focusFixture.reverse();
            // Composed ranges expose the actual shadow-tree boundaries, not the
            // document selection's re-scoped host boundary.
            const range = selection.getComposedRanges({
              shadowRoots: [shadow],
            })[0];
            return {
              focused: shadow.activeElement === editor,
              selection:
                kind === "input"
                  ? [
                      (editor as HTMLInputElement).selectionStart,
                      (editor as HTMLInputElement).selectionEnd,
                      (editor as HTMLInputElement).selectionDirection,
                    ]
                  : [range.startOffset, range.endOffset, selection.direction],
              sameText:
                kind === "input" ||
                (range.startContainer === editor.firstChild &&
                  range.endContainer === editor.firstChild),
            };
          },
          { fallback, kind, mode },
        );
        expect(result).toEqual({
          focused: true,
          selection: [2, 8, "backward"],
          sameText: true,
        });
      });
    }
  }
}

test("fallback selection repair does not scroll an offscreen editor", async ({
  page,
}) => {
  await page.evaluate(async () => {
    window.focusFixture.mount("contenteditable", true, true);
    const editor = document.getElementById("editor")!;
    editor.focus({ preventScroll: true });
    document
      .getSelection()!
      .setBaseAndExtent(editor.firstChild!, 2, editor.firstChild!, 8);
    await new Promise(requestAnimationFrame);
    window.scrollTo(0, 0);
    window.focusFixture.reverse();
  });
  await expect(page.locator("#editor")).toBeFocused();
  expect(
    await page.evaluate(() => ({
      scroll: window.scrollY,
      text: document.getSelection()!.toString(),
    })),
  ).toEqual({ scroll: 0, text: "lected" });
});

for (const fallback of [false, true]) {
  test(`preserves an editor when its shadow host moves (${fallback ? "fallback" : "native"})`, async ({
    page,
  }) => {
    if (!fallback) await requireAtomicMoves(page);
    const result = await page.evaluate((fallback) => {
      customElements.define(
        "move-editor",
        class extends HTMLElement {
          constructor() {
            super();
            const editor = document.createElement("div");
            editor.contentEditable = "true";
            editor.textContent = "Selected text";
            this.attachShadow({ mode: "open" }).append(editor);
          }
          connectedMoveCallback() {}
        },
      );
      window.focusFixture.mount("input", "custom", fallback);
      const shadow = document.querySelector("move-editor")!.shadowRoot!;
      const editor = shadow.firstElementChild as HTMLElement;
      editor.focus();
      const selection = document.getSelection()!;
      selection.setBaseAndExtent(editor.firstChild!, 8, editor.firstChild!, 2);
      window.focusFixture.reverse();
      const range = selection.getComposedRanges({ shadowRoots: [shadow] })[0];
      return {
        focused: shadow.activeElement === editor,
        text: selection.toString(),
        direction: selection.direction,
        sameText:
          range.startContainer === editor.firstChild &&
          range.endContainer === editor.firstChild,
        offsets: [range.startOffset, range.endOffset],
      };
    }, fallback);
    expect(result).toEqual({
      focused: true,
      text: "lected",
      direction: "backward",
      sameText: true,
      offsets: [2, 8],
    });
  });
}

test("restores once after all fallback placements", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.focusFixture.mount("input", false, true);
    window.focusFixture.reorder(["moved", "other", "third"]);
    const editor = document.getElementById("editor") as HTMLInputElement;
    editor.focus();
    editor.setSelectionRange(2, 8, "backward");
    let restores = 0;
    editor.addEventListener("focus", () => restores++);
    const parent = document.getElementById("list")!;
    const insert = parent.insertBefore.bind(parent);
    const observed: string[] = [];
    parent.insertBefore = (node, before) => {
      const result = insert(node, before);
      document.getElementById("other")!.focus();
      observed.push(document.activeElement!.id);
      return result;
    };
    let restoredBeforePaint = false;
    window.focusFixture.beforePaint = () => {
      restoredBeforePaint = document.activeElement === editor;
    };
    window.focusFixture.reorder(["third", "other", "moved"]);
    return {
      observed,
      restores,
      restoredBeforePaint,
      focused: document.activeElement === editor,
      selection: [
        editor.selectionStart,
        editor.selectionEnd,
        editor.selectionDirection,
      ],
    };
  });
  expect(result).toEqual({
    observed: ["other", "other"],
    restores: 1,
    restoredBeforePaint: true,
    focused: true,
    selection: [2, 8, "backward"],
  });
});

for (const change of ["shorten", "replace"] as const) {
  test(`selection restoration tolerates ${change === "shorten" ? "shortened" : "replaced"} text nodes`, async ({
    page,
  }) => {
    const result = await page.evaluate((change) => {
      let moving = false;
      customElements.define(
        "move-editor",
        class extends HTMLElement {
          connectedCallback() {
            if (!moving) return;
            const editor = document.getElementById("editor")!;
            if (change === "shorten") editor.firstChild!.textContent = "Short";
            else editor.replaceChildren(document.createTextNode("Replacement"));
          }
        },
      );
      window.focusFixture.mount("contenteditable", "custom", true);
      const editor = document.getElementById("editor")!;
      editor.focus();
      const selection = document.getSelection()!;
      const text = editor.firstChild!;
      selection.setBaseAndExtent(text, 8, text, 2);
      moving = true;
      window.focusFixture.reverse();
      return {
        focused: document.activeElement === editor,
        anchor: selection.anchorOffset,
        focus: selection.focusOffset,
        detachedSelection: !selection.anchorNode?.isConnected,
      };
    }, change);
    expect(result.focused).toBe(true);
    expect(result.detachedSelection).toBe(false);
    if (change === "shorten")
      expect([result.anchor, result.focus]).toEqual([5, 2]);
  });
}

for (const fallback of [false, true]) {
  for (const direction of ["forward", "backward"] as const) {
    for (const { change, keys, expected } of [
      {
        change: "insert",
        keys: ["NEW", "AA", "BB", "CC"],
        expected: "NEWAAXCC",
      },
      { change: "delete", keys: ["BB", "CC"], expected: "XCC" },
      { change: "move earlier", keys: ["BB", "AA", "CC"], expected: "XAACC" },
      { change: "move later", keys: ["AA", "CC", "BB"], expected: "AACCX" },
    ]) {
      test(`child boundaries retain ${direction} selected text after ${change} (${fallback ? "fallback" : "native"})`, async ({
        page,
      }) => {
        if (!fallback) await requireAtomicMoves(page);
        await page.evaluate(
          ({ fallback, direction, keys }) => {
            window.focusFixture.mountChildren(fallback);
            const editor = document.getElementById("editor")!;
            editor.focus();
            document
              .getSelection()!
              .setBaseAndExtent(
                editor,
                direction === "forward" ? 1 : 2,
                editor,
                direction === "forward" ? 2 : 1,
              );
            window.focusFixture.updateChildren(keys);
          },
          { fallback, direction, keys },
        );
        expect(
          await page.evaluate(() => document.getSelection()!.direction),
        ).toBe(direction);
        await page.keyboard.insertText("X");
        await expect(page.locator("#editor")).toHaveText(expected);
      });
    }
  }
}

for (const { position, offset, keys, expected } of [
  {
    position: "start",
    offset: 0,
    keys: ["NEW", "AA", "BB", "CC"],
    expected: "NEWXAABBCC",
  },
  {
    position: "middle",
    offset: 1,
    keys: ["NEW", "AA", "BB", "CC"],
    expected: "NEWAAXBBCC",
  },
  {
    position: "end",
    offset: 3,
    keys: ["AA", "BB", "CC", "NEW"],
    expected: "AABBCCXNEW",
  },
]) {
  test(`child boundaries keep a collapsed ${position} caret beside its original child`, async ({
    page,
  }) => {
    await page.evaluate(
      ({ offset, keys }) => {
        window.focusFixture.mountChildren(true);
        const editor = document.getElementById("editor")!;
        editor.focus();
        document.getSelection()!.collapse(editor, offset);
        window.focusFixture.updateChildren(keys);
      },
      { offset, keys },
    );
    expect(
      await page.evaluate(() => document.getSelection()!.isCollapsed),
    ).toBe(true);
    await page.keyboard.insertText("X");
    await expect(page.locator("#editor")).toHaveText(expected);
  });
}

for (const { change, start, end, keys } of [
  { change: "removed boundary child", start: 1, end: 2, keys: ["AA", "CC"] },
  {
    change: "replaced boundary child",
    start: 1,
    end: 2,
    keys: ["AA", "REPLACEMENT", "CC"],
  },
  {
    change: "reversed boundary children",
    start: 0,
    end: 2,
    keys: ["BB", "AA", "CC"],
  },
]) {
  test(`child boundaries skip restoration for ${change}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ start, end, keys }) => {
        window.focusFixture.mountChildren(true);
        const editor = document.getElementById("editor")!;
        editor.focus();
        const selection = document.getSelection()!;
        selection.setBaseAndExtent(editor, start, editor, end);
        let restores = 0;
        const select = selection.setBaseAndExtent.bind(selection);
        selection.setBaseAndExtent = (...args) => {
          restores++;
          select(...args);
        };
        window.focusFixture.updateChildren(keys);
        return { restores, connected: selection.anchorNode?.isConnected };
      },
      { start, end, keys },
    );
    expect(result).toEqual({ restores: 0, connected: true });
  });
}

for (const once of [true, false]) {
  test(`restoration uses one selection repair and one focus attempt with a ${once ? "one-shot" : "persistent"} focus redirect`, async ({
    page,
  }) => {
    const result = await page.evaluate((once) => {
      window.focusFixture.mount("contenteditable", true, true);
      const editor = document.getElementById("editor")!;
      editor.focus();
      const selection = document.getSelection()!;
      selection.setBaseAndExtent(editor.firstChild!, 2, editor.firstChild!, 8);
      let callbacks = 0;
      let focusCalls = 0;
      let selectionCalls = 0;
      editor.addEventListener(
        "focus",
        () => {
          callbacks++;
          document.getElementById("other")!.focus();
        },
        { once },
      );
      const focus = editor.focus.bind(editor);
      editor.focus = (options) => {
        focusCalls++;
        focus(options);
      };
      const select = selection.setBaseAndExtent.bind(selection);
      selection.setBaseAndExtent = (...args) => {
        selectionCalls++;
        select(...args);
      };
      window.focusFixture.reverse();
      return {
        callbacks,
        focusCalls,
        selectionCalls,
        active: document.activeElement?.id,
      };
    }, once);
    expect(result).toEqual({
      callbacks: once ? 1 : 2,
      focusCalls: 1,
      selectionCalls: 1,
      active: once ? "editor" : "other",
    });
  });
}

test("child boundaries preserve a mixed element/text range", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.focusFixture.mountChildren(true);
    const editor = document.getElementById("editor")!;
    editor.focus();
    document
      .getSelection()!
      .setBaseAndExtent(editor, 1, editor.childNodes[1].firstChild!, 1);
    window.focusFixture.updateChildren(["NEW", "AA", "BB", "CC"]);
  });
  await page.keyboard.insertText("X");
  await expect(page.locator("#editor")).toHaveText("NEWAAXBCC");
});

test("child boundaries retain an empty editor's caret at its start", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.focusFixture.mountChildren(true);
    window.focusFixture.updateChildren([]);
    const editor = document.getElementById("editor")!;
    editor.focus();
    document.getSelection()!.collapse(editor, 0);
    window.focusFixture.updateChildren(["NEW"]);
  });
  await page.keyboard.insertText("X");
  await expect(page.locator("#editor")).toHaveText("XNEW");
});

test("unchanged child boundaries avoid selection repair and visibility checks", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.focusFixture.mountChildren(true);
    const editor = document.getElementById("editor")!;
    editor.focus();
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(editor, 1, editor, 2);
    let restores = 0;
    let checks = 0;
    const select = selection.setBaseAndExtent.bind(selection);
    selection.setBaseAndExtent = (...args) => {
      restores++;
      select(...args);
    };
    const check = editor.checkVisibility.bind(editor);
    editor.checkVisibility = (options) => {
      checks++;
      return check(options);
    };
    window.focusFixture.updateChildren(["AA", "BB", "CC"]);
    return { restores, checks };
  });
  expect(result).toEqual({ restores: 0, checks: 0 });
  await page.keyboard.insertText("X");
  await expect(page.locator("#editor")).toHaveText("AAXCC");
});

for (const kind of ["callback", "host"] as const) {
  test(`${kind} binding focus runs after full commit restoration`, async ({
    page,
  }) => {
    const result = await page.evaluate((kind) => {
      const outside = document.createElement("button");
      document.body.append(outside);
      outside.focus();
      window.focusFixture.renderBinding(kind, "focus");
      const mountFocused = document.activeElement?.id;
      const mountObservations = [...window.focusFixture.bindingObservations];
      outside.focus();
      window.focusFixture.bindingObservations.length = 0;
      window.focusFixture.renderBinding(kind, "focus");
      return {
        mountFocused,
        mountObservations,
        updateFocused: document.activeElement?.id,
        updateObservations: window.focusFixture.bindingObservations,
      };
    }, kind);
    expect(result.mountFocused).toBe("binding-target");
    expect(result.mountObservations).toEqual(
      test.info().project.name.endsWith("development")
        ? ["focus", "focus-event", "focus"]
        : ["focus", "focus-event"],
    );
    expect(result.updateFocused).toBe("binding-target");
    expect(result.updateObservations).toEqual(["focus", "focus-event"]);
  });

  for (const action of ["selection", "blur"] as const) {
    test(`${kind} binding ${action} survives restoration`, async ({ page }) => {
      const result = await page.evaluate(
        ({ kind, action }) => {
          window.focusFixture.renderBinding(kind, "none");
          const input = document.getElementById(
            "binding-target",
          ) as HTMLInputElement;
          input.focus();
          input.setSelectionRange(2, 8);
          window.focusFixture.bindingObservations.length = 0;
          window.focusFixture.renderBinding(kind, action);
          return {
            focused: document.activeElement === input,
            selection: [input.selectionStart, input.selectionEnd],
            observations: window.focusFixture.bindingObservations,
          };
        },
        { kind, action },
      );
      expect(result.observations).toEqual([action]);
      expect(result.focused).toBe(action === "selection");
      if (action === "selection") expect(result.selection).toEqual([0, 3]);
    });
  }

  test(`${kind} hydration binding focuses after publishing the committed tree`, async ({
    page,
  }) => {
    const result = await page.evaluate((kind) => {
      const container = document.getElementById("root")!;
      container.innerHTML =
        '<input id="binding-target" value="Selected text"><output id="binding-output">focus</output>';
      const input = container.firstElementChild;
      const outside = document.createElement("button");
      document.body.append(outside);
      outside.focus();
      window.focusFixture.renderBinding(kind, "focus", undefined, true);
      return {
        reused: container.firstElementChild === input,
        focused: document.activeElement === input,
        observations: window.focusFixture.bindingObservations,
      };
    }, kind);
    expect(result.reused).toBe(true);
    expect(result.focused).toBe(true);
    expect(result.observations).toContain("focus-event");
  });

  test(`${kind} Activity binding skips hide and focuses on reveal`, async ({
    page,
  }) => {
    const result = await page.evaluate((kind) => {
      window.focusFixture.renderBinding(kind, "focus", false);
      const outside = document.createElement("button");
      document.body.append(outside);
      outside.focus();
      window.focusFixture.bindingObservations.length = 0;
      window.focusFixture.renderBinding(kind, "focus", true);
      const hiddenObservations = [...window.focusFixture.bindingObservations];
      const hiddenFocused = document.activeElement === outside;
      window.focusFixture.renderBinding(kind, "focus", false);
      return {
        hiddenObservations,
        hiddenFocused,
        revealedFocus: document.activeElement?.id,
        observations: window.focusFixture.bindingObservations,
      };
    }, kind);
    expect(result.hiddenObservations).toEqual([]);
    expect(result.hiddenFocused).toBe(true);
    expect(result.revealedFocus).toBe("binding-target");
    expect(result.observations).toEqual(["focus", "focus-event"]);
  });
}
