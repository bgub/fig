import { defineConfig } from "@playwright/test";

const port = 4184;

export default defineConfig({
  expect: {
    timeout: 7_000,
  },
  // Serial on purpose: the specs assert transient streaming phases (pending
  // slots between payload rows) that get batched away when parallel browser
  // instances starve the client of CPU.
  workers: 1,
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
      PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/`,
  },
});
