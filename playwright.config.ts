import { defineConfig, devices } from "@playwright/test"
import os from "node:os"
import path from "node:path"

// Isolated E2E stack: its own API (default 3101, the seeded ERP database, temp uploads) and
// its own Vite dev server (default 5174) so the developer's running servers are never touched.
// SAPHIR_DB_FILE points at a throwaway copy of the seeded database (tests/e2e/support/erp-db.ts)
// whose as_of is pinned to the seed manifest, so the suite is deterministic on any calendar day.
const API_PORT = process.env.E2E_API_PORT ?? "3101"
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5174"
const API = `http://127.0.0.1:${API_PORT}/api/v1`
const WEB = `http://localhost:${WEB_PORT}`
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: `reports/evidence/playwright_${process.env.QA_PHASE ?? "adhoc"}.json` }]],
  use: { baseURL: WEB, channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: [
    {
      // Refresh the throwaway ERP database (immutable manifest as_of) before the API starts.
      command: "npx tsx tests/e2e/support/erp-db.ts",
      env: { ERP_DB_FILE: process.env.E2E_DB_FILE ?? path.resolve("var/e2e-ai-negoce.db") },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx tsx server/index.ts",
      url: `${API}/livez`,
      env: {
        API_PORT,
        NODE_ENV: "development",
        // Explicit local development identities; the API binds to loopback only.
        AUTH_MODE: "local-dev",
        HOST: "127.0.0.1",
        LOG_LEVEL: "silent",
        FRONTEND_ORIGIN: WEB,
        ERP_DB_FILE: process.env.E2E_DB_FILE ?? path.resolve("var/e2e-ai-negoce.db"),
        UPLOAD_DIR: path.join(os.tmpdir(), "ai-negoce-e2e-uploads"),
        RATE_LIMIT_PER_MINUTE: "1000",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB,
      env: { PORT: WEB_PORT, VITE_API_URL: API, VITE_DEV_IDENTITY: "admin" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
