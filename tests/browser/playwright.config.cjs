const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: ".",
  workers: 1,
  reporter: process.env.CI === "true" ? "github" : "list",
  use: { trace: "on-first-retry" },
});
