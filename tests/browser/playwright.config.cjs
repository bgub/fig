const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: ".",
  workers: 1,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "firefox",
      testMatch: ["submenu.spec.ts", "popup-position.spec.ts"],
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      testMatch: ["submenu.spec.ts", "popup-position.spec.ts"],
      use: { browserName: "webkit" },
    },
  ],
  reporter: process.env.CI === "true" ? "github" : "list",
  use: { trace: "on-first-retry" },
});
