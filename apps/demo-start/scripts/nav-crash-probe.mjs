// Dev-only probe: rapid nav Home -> Data -> Dashboard -> Assets, capturing
// page errors (removeChild NotFoundError repro) and the ?v= generation of
// every loaded fig chunk (mixed generations = stale prebundle, not a bug).
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "https://fig-demo-start.localhost";
const attempts = Number(process.argv[3] ?? 10);
const clickGapMs = Number(process.argv[4] ?? 150);
const labels = (process.argv[5] ?? "Data,Dashboard,Assets").split(",");

const browser = await chromium.launch({
  args: ["--ignore-certificate-errors"],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (error) => errors.push(String(error?.stack ?? error)));
const debugLogs = [];
page.on("console", (message) => {
  const text = message.text();
  if (text.includes("[DEBUG-")) debugLogs.push(text);
});

const chunkGenerations = new Set();
page.on("request", (request) => {
  const url = request.url();
  const match = /\?v=([0-9a-f]+)/.exec(url);
  if (match && /fig|dist-/.test(url)) chunkGenerations.add(match[1]);
});

let failedAttempt = null;
for (let attempt = 0; attempt < attempts; attempt += 1) {
  errors.length = 0;
  await page.goto(base, { waitUntil: "networkidle" });
  for (const label of labels) {
    await page.click(`nav >> text="${label}"`);
    await page.waitForTimeout(clickGapMs);
  }
  await page.waitForTimeout(1500);
  if (errors.length > 0) {
    failedAttempt = attempt;
    break;
  }
}

console.log(
  JSON.stringify(
    {
      chunkGenerations: [...chunkGenerations],
      debugLogs,
      errors,
      failedAttempt,
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
