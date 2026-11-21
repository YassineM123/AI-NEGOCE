import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8444",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run agentic:dev",
    url: "http://127.0.0.1:8444",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
