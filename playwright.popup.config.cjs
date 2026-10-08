const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./apps/demo-tanstack-start/e2e",
  testMatch: ["popup-commit.spec.ts"],
  workers: 1,
  reporter: "list",
});
