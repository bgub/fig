// Dev-only probe: keeps a page open for N seconds and reports whether a
// full reload happened (marker wiped) while something rebuilds out-of-band.
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:4188";
const watchMs = Number(process.argv[3] ?? 30_000);

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (message) => logs.push(message.text()));

await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__hmrProbeMarker = "alive";
});
console.log("PAGE_READY");

await page.waitForTimeout(watchMs);

const marker = await page.evaluate(() => window.__hmrProbeMarker ?? null);
console.log(
  JSON.stringify({
    logs: logs.filter((text) => text.includes("FIG_CORE_PROBE")),
    reloaded: marker !== "alive",
  }),
);
await browser.close();
