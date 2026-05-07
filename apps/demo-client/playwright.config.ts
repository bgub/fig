import { defineConfig } from "@playwright/test";

const port = 4182;

export default defineConfig({
  expect: {
    timeout: 7_000,
  },
  fullyParallel: true,
  outputDir: "test-results",
  reporter: process.env.CI === "true" ? "github" : "list",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm build:e2e && python3 -m http.server ${port} --bind 127.0.0.1`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/`,
  },
});
