const { defineConfig } = require("@playwright/test");

const port = 4185;

module.exports = defineConfig({
  expect: {
    timeout: 7_000,
  },
  fullyParallel: true,
  workers: process.env.CI === "true" ? 1 : 4,
  outputDir: "test-results",
  reporter: process.env.CI === "true" ? "github" : "list",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command:
      process.env.FIG_E2E_PREBUILT === "1"
        ? "pnpm serve"
        : "pnpm build:e2e && pnpm serve",
    env: {
      PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/`,
  },
});
