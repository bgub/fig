// Dev-only probe: loads the dev server root in headless Chromium and prints
// every network request, so prebundling changes can be compared by count.
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:4188";
const settleMs = Number(process.env.SETTLE_MS ?? 3000);

const browser = await chromium.launch();
const page = await browser.newPage();

const requests = [];
page.on("request", (request) => {
  requests.push({ method: request.method(), url: request.url() });
});
const failures = [];
page.on("requestfailed", (request) => {
  failures.push({ error: request.failure()?.errorText, url: request.url() });
});
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => {
  consoleErrors.push(String(error));
});

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(settleMs);

const title = await page.title();
const heading = await page
  .locator("h1")
  .first()
  .textContent()
  .catch(() => null);

console.log(JSON.stringify({ base, heading, title }, null, 2));
console.log(`\nTotal requests: ${requests.length}`);
for (const request of requests) {
  console.log(`  ${request.method} ${request.url.replace(base, "")}`);
}
if (failures.length > 0) {
  console.log(`\nFailed requests (${failures.length}):`);
  for (const failure of failures) {
    console.log(`  ${failure.url}: ${failure.error}`);
  }
}
if (consoleErrors.length > 0) {
  console.log(`\nConsole errors (${consoleErrors.length}):`);
  for (const text of consoleErrors) console.log(`  ${text}`);
}

await browser.close();
