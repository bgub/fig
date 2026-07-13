// Dev-only probe: loads the dev server, mutates a source file, and reports
// whether the page updated in place (fig-refresh) or via a full reload.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:4188";
const file = process.argv[3];
const search = process.argv[4];
const replace = process.argv[5];
const expectText = process.argv[6];

if (!file || !search || !replace || !expectText) {
  console.error(
    "usage: hmr-probe.mjs <base> <file> <search> <replace> <expect-text>",
  );
  process.exit(2);
}

const original = await readFile(file, "utf8");
if (!original.includes(search)) {
  console.error(`search string not found in ${file}`);
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => {
  consoleErrors.push(String(error));
});

try {
  await page.goto(base, { waitUntil: "networkidle" });
  // A full reload wipes this marker; an in-place refresh keeps it.
  await page.evaluate(() => {
    window.__hmrProbeMarker = "alive";
  });

  await writeFile(file, original.replace(search, replace));
  await page
    .getByText(expectText)
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});

  const updated = (await page.getByText(expectText).count()) > 0;
  const marker = await page.evaluate(() => window.__hmrProbeMarker ?? null);

  console.log(
    JSON.stringify(
      {
        consoleErrors,
        mode:
          updated && marker === "alive"
            ? "in-place refresh"
            : updated
              ? "full reload"
              : "NO UPDATE",
        updated,
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(file, original);
  await browser.close();
}
