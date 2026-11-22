import { defineConfig, devices } from "@playwright/test"

/** Optional real loopback API for the full UI recipe.
 * Individual browser contract tests can still mock selected backend requests;
 * unmocked calls now reach a real local API instead of ECONNREFUSED.
 * Persistence across UI tests is intentionally ephemeral (MemoryStore).
 * Real PostgreSQL persistence is separately tested by the PG recipe job.
 */
const realApi = process.env.RECETTE_REAL_API === "1"
export default defineConfig({
  testDir: "./tests",
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8444",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    ...(realApi ? [{
      command: "npx tsx server/index.ts",
      url: "http://127.0.0.1:3001/api/v1/livez",
      env: {
        ...process.env,
        NODE_ENV: "test",
        AUTH_MODE: "local-dev",
        HOST: "127.0.0.1",
        API_PORT: "3001",
        FRONTEND_ORIGIN: "http://127.0.0.1:8444",
        UNIFIED_ANALYTICS_SOURCE: "legacy",
        RATE_LIMIT_PER_MINUTE: "1000",
        DATABASE_URL: "",
        LOG_LEVEL: "silent",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    }] : []),
    {
      command: "npm run agentic:dev",
      url: "http://127.0.0.1:8444",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
