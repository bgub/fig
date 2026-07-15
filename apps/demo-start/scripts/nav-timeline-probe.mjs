// Dev-only probe: capture the DOM state timeline of <main> across a client
// navigation, so intermediate commits (blank slot, placeholders, reveals)
// are visible with timings.
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "https://fig-demo-start.localhost";
const target = process.argv[3] ?? "Assets";
const settleMs = Number(process.argv[4] ?? 3000);

const browser = await chromium.launch({
  args: ["--ignore-certificate-errors"],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

const debugLogs = [];
page.on("console", (message) => {
  const text = message.text();
  if (text.includes("[DEBUG-")) debugLogs.push(text);
});

await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => {
  const main = document.querySelector("main");
  const states = [];
  let last = "";
  const snapshot = () => {
    const text = (main?.textContent ?? "").replaceAll(/\s+/g, " ").trim();
    const slot = main?.querySelector("[data-fig-payload-slot]");
    const state = JSON.stringify({
      slotChildren: slot === null ? null : (slot?.childNodes.length ?? null),
      slotEmpty: slot ? slot.textContent.trim() === "" : null,
      text: text.slice(0, 180),
    });
    if (state !== last) {
      last = state;
      states.push({ t: performance.now(), state: JSON.parse(state) });
    }
  };
  snapshot();
  const observer = new MutationObserver(snapshot);
  observer.observe(main, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  window.__navTimeline = { start: performance.now(), states };
});

await page.click(`nav >> text="${target}"`);
await page.waitForTimeout(settleMs);

const { start, timeline } = await page.evaluate(() => {
  const { start, states } = window.__navTimeline;
  return {
    start: Math.round(start),
    timeline: states.map((entry) => ({
      ms: Math.round(entry.t - start),
      ...entry.state,
    })),
  };
});
console.log(JSON.stringify({ observerStart: start, timeline }, null, 1));
for (const log of debugLogs) console.log(log.slice(0, 400));
await browser.close();
