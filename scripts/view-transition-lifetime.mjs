import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
import { build } from "tsdown";

// Bundle the real DOM surface implementation; no animation enumeration is used
// in this probe because that is a separate historical Safari crash surface.
const bundles = await build({
  config: false,
  entry: "packages/fig-dom/src/view-transition-pseudos.ts",
  format: "iife",
  globalName: "figPseudos",
  platform: "browser",
  write: false,
  dts: false,
  logLevel: "silent",
});
const source = bundles
  .flatMap((bundle) => bundle.chunks)
  .filter((chunk) => chunk.type === "chunk")
  .map((chunk) => chunk.code)
  .join("\n");

for (const [name, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch();
  try {
    for (const mode of ["finish", "skip"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(`
        <style>
          ::view-transition-group(*) { animation-duration: 80ms }
          ::view-transition-new(*) { animation: none; opacity: 1 }
          #card { view-transition-name: card; width: 120px; height: 80px; background: red }
        </style>
        <div id="card">one</div>
      `);
      await page.addScriptTag({ content: source });
      const result = await page.evaluate(async (completion) => {
        const bounded = (promise) =>
          Promise.race([
            promise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Transition timed out")), 3000),
            ),
          ]);
        const element = document.getElementById("card");
        const controller = new AbortController();
        const transition = document.startViewTransition(() => {
          element.textContent = "two";
        });
        await bounded(transition.ready);
        const surface = window.figPseudos.createDOMViewTransitionSurface(
          element,
          "card",
          { old: true, new: true },
          controller.signal,
        );
        const pseudo =
          window.figPseudos.getViewTransitionPseudoElements(surface).new;
        const animation = pseudo.animate(
          { opacity: [0.2, 0.2] },
          {
            duration: completion === "skip" ? 10_000 : 30,
            fill: "forwards",
          },
        );
        if (completion === "skip") transition.skipTransition();
        await bounded(transition.finished);
        controller.abort();
        const state = animation.playState;
        const progress = animation.effect.getComputedTiming().progress;
        const next = document.startViewTransition(() => {
          element.textContent = "three";
        });
        await bounded(next.ready);
        const beforeStale = getComputedStyle(
          document.documentElement,
          "::view-transition-new(card)",
        ).opacity;
        let staleRejected = false;
        try {
          pseudo.animate(
            { opacity: [0, 0] },
            { duration: 30, fill: "forwards" },
          );
        } catch (error) {
          staleRejected = error.message.includes("no longer active");
        }
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const afterStale = getComputedStyle(
          document.documentElement,
          "::view-transition-new(card)",
        ).opacity;
        await bounded(next.finished);
        return { state, progress, beforeStale, afterStale, staleRejected };
      }, mode);
      assert.deepEqual(
        result,
        {
          state: "idle",
          progress: null,
          beforeStale: "1",
          afterStale: "1",
          staleRejected: true,
        },
        `${name}: ${mode}`,
      );
      assert.deepEqual(errors, [], `${name}: ${mode} browser errors`);
      console.log(
        `${name} ${browser.version()} (${mode}): ${JSON.stringify(result)}`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
