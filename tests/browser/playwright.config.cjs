const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: ".",
  workers: 1,
  projects: [
    {
      name: "chromium",
      testIgnore: "focus-preservation.spec.ts",
      use: { browserName: "chromium" },
    },
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
    ...["chromium", "firefox", "webkit"].flatMap((browserName) =>
      ["development", "production"].map((mode) => ({
        name: `${browserName}-${mode}`,
        testMatch: "focus-preservation.spec.ts",
        use: { browserName, trace: "retain-on-failure" },
      })),
    ),
  ],
  reporter: process.env.CI === "true" ? "github" : "list",
  use: { trace: "on-first-retry" },
});
