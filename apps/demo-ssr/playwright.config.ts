import { defineConfig } from "@playwright/test";

const port = 4181;

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
    command: "pnpm build:e2e && pnpm serve",
    env: {
      // Shrink the demo's human-scale streaming delays (5s Suspense reveal
      // etc.) so tests exercise the same flows without real-time waits.
      FIG_STREAM_DEMO_DELAY_SCALE: "0.25",
      PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/`,
  },
});
