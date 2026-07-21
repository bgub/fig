// Run beside the TanStack Start dev server to verify that a component edit
// preserves both page state and a marker that only survives an in-place HMR
// update. The source file is restored even if the probe fails.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4185";
const file = new URL("../src/components/AssetLabIsland.tsx", import.meta.url);
const before = "Client asset island";
const after = "Client asset island · refreshed";
const original = await readFile(file, "utf8");

if (!original.includes(before)) {
  throw new Error(`Could not find the HMR probe label in ${file.pathname}.`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

try {
  await page.goto(`${base}/asset-lab`, { waitUntil: "networkidle" });
  const island = page.getByRole("button", { name: /Client asset island/ });
  await island.click();
  await page.getByText("clicks: 1").waitFor();
  await page.evaluate(() => {
    window.__figHmrProbeMarker = "alive";
  });

  await writeFile(file, original.replace(before, after));
  await page.getByText(after).waitFor({ timeout: 15_000 });

  const marker = await page.evaluate(() => window.__figHmrProbeMarker ?? null);
  const statePreserved = (await page.getByText("clicks: 1").count()) === 1;
  const inPlace = marker === "alive" && statePreserved;

  console.log(
    JSON.stringify(
      {
        errors,
        mode: inPlace ? "in-place refresh" : "full reload",
        statePreserved,
      },
      null,
      2,
    ),
  );

  if (!inPlace || errors.length > 0) process.exitCode = 1;
} finally {
  await writeFile(file, original);
  await browser.close();
}
