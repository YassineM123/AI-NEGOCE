import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createApp } from "./app.js"
import { loadConfig } from "./config.js"
import { MemoryStore } from "./store.js"
import { DisabledOcrProvider } from "./ocr.js"
import { TestErpAdapter } from "./erp.js"
import { ErpDatabase, periodRange } from "./erp-db.js"

const csvDir = path.resolve("datasets/synthetic/v1/csv")
const dbFile = path.join(os.tmpdir(), `ai-negoce-${crypto.randomUUID()}.db`)
let erpDb: ErpDatabase
let app: ReturnType<typeof createApp>
const admin = { Authorization: "Bearer dev-admin" }

beforeAll(() => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/db-seed.ts", csvDir, dbFile], { stdio: "ignore" })
  erpDb = new ErpDatabase(dbFile)
  app = createApp({
    config: loadConfig({ NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:8443" }),
    store: new MemoryStore(),
    ocr: new DisabledOcrProvider(),
    erp: new TestErpAdapter(),
    erpDb,
  })
}, 60_000)
afterAll(() => {
  erpDb?.close()
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true })
})

describe.skipIf(!fs.existsSync(csvDir))("dashboard from the ERP database", () => {
  it("returns KPIs, a 12-month trend and alerts", async () => {
    const res = await request(app).get("/api/v1/dashboard?period=month").set(admin)
    expect(res.status).toBe(200)
    expect(res.body.asOf).toBe("2026-06-30")
    expect(res.body.range).toEqual({ from: "2026-06-01", to: "2026-06-30" })
    expect(res.body.trend).toHaveLength(12)
    expect(res.body.trend.at(-1).month).toBe("2026-06")
    expect(res.body.kpis.revenue).toBeGreaterThan(0)
    expect(res.body.kpis.grossMargin).toBeLessThan(res.body.kpis.revenue)
    expect(res.body.agencies).toHaveLength(5)
    expect(new Set(res.body.activity.map((a: { type: string }) => a.type)).size).toBeGreaterThan(1)
  })
  it("matches the monthly trend point for the current month", async () => {
    const res = await request(app).get("/api/v1/dashboard?period=month").set(admin)
    expect(res.body.trend.at(-1).revenue).toBeCloseTo(res.body.kpis.revenue, 3)
  })
  it("splits totals by agency and enforces agency scope", async () => {
    const all = (await request(app).get("/api/v1/dashboard?period=year").set(admin)).body
    let sum = 0
    for (const agency of all.agencies) {
      const one = await request(app).get(`/api/v1/dashboard?period=year&agency=${encodeURIComponent(agency)}`).set(admin)
      sum += one.body.kpis.revenue
    }
    expect(sum).toBeCloseTo(all.kpis.revenue, 2)
    const sfax = { Authorization: "Bearer dev-manager-sfax" }
    expect((await request(app).get("/api/v1/dashboard?agency=Sousse").set(sfax)).status).toBe(403)
    const scoped = await request(app).get("/api/v1/dashboard?period=year").set(sfax)
    expect(scoped.body.kpis.revenue).toBeLessThan(all.kpis.revenue)
  })
  it("rejects unknown periods", async () => {
    expect((await request(app).get("/api/v1/dashboard?period=week").set(admin)).status).toBe(400)
  })
})

describe("periodRange", () => {
  it("covers period to date", () => {
    expect(periodRange("2026-06-30", "quarter")).toEqual({ from: "2026-04-01", to: "2026-06-30" })
    expect(periodRange("2026-06-30", "year")).toEqual({ from: "2026-01-01", to: "2026-06-30" })
  })
})
