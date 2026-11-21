import { describe, expect, it } from "vitest"
import request from "supertest"
import { createApp, defaultDependencies } from "./app.js"
import { loadConfig } from "./config.js"
import { loadExtractedDemo, verifySyntheticComplements, UNATTRIBUTED_AGENCY } from "./demo-database.js"

describe("Phase 2 pseudonymized IAINEG database demo", () => {
  it("loads exactly the TND documents and preserves separate EUR/USD totals", () => {
    const { dataset, quality } = loadExtractedDemo()
    expect(quality.sales.totalDocuments).toBe(3158)
    expect(quality.sales.distinctDocuments).toBe(3158)
    expect(quality.sales.tndDocumentsUsedForSharedAnalytics).toBe(3101)
    expect(quality.sales.currencies.TND).toEqual({ documents: 3101, totalHt: "41223328.922" })
    expect(quality.sales.currencies.EUR).toEqual({ documents: 56, totalHt: "8054293.099" })
    expect(quality.sales.currencies.USD).toEqual({ documents: 1, totalHt: "152049.180" })
    expect(dataset.sales).toHaveLength(3101)
    expect(dataset.sales.every((s) => s.agency === UNATTRIBUTED_AGENCY && s.cost === null)).toBe(true)
    expect(dataset.receivables).toEqual([])
    expect(dataset.inventory).toEqual([])
    expect(dataset.metadata.asOf).toBe("2026-10-20")
  })

  it("discloses missing cost/valuation and source reconciliation restrictions", () => {
    const { quality } = loadExtractedDemo()
    expect(quality.demoOnly).toBe(true)
    expect(quality.sqlReconciled).toBe(false)
    expect(quality.sales.clients).toBe(693)
    expect(quality.inventory.rows).toBe(4619)
    expect(quality.inventory.rowsWithoutPmpValue).toBe(4618)
    expect(quality.receivables.agingRows).toBe(563)
    expect(quality.receivables.clients).toBe(425)
    expect(quality.profit.invoiceLevelMarginAvailable).toBe(false)
    expect(quality.syntheticComplements.every((file) => file.startsWith("demonstration/"))).toBe(true)
  })

  it("keeps supplier and treasury scenario supplements internally consistent, never joined to IAINEG", () => {
    expect(verifySyntheticComplements()).toEqual({ demoOnly: true, source: "synthetic_scenarios", supplierDeliveries: 8, cashPlanMonths: 6 })
  })

  it("cannot enable original pseudonymized extracts in production", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      DEMO_DATA_SOURCE: "extractions",
    } as NodeJS.ProcessEnv)).toThrow(/forbidden in production/)
  })

  it("serves the same TND extract to the 3 governed consumers, not the seeded ERP sandbox", async () => {
    const deps = defaultDependencies({
      NODE_ENV: "test",
      AUTH_MODE: "local-dev",
      HOST: "127.0.0.1",
      DEMO_DATA_SOURCE: "extractions",
    } as NodeJS.ProcessEnv)
    const app = createApp(deps)
    const session = await request(app).post("/api/v1/auth/dev-session").send({ identity: "admin" })
    expect(session.status).toBe(200)
    const headers = { Authorization: "Bearer " + session.body.token }

    const qa = await request(app).get("/api/v1/demo/database/quality").set(headers)
    expect(qa.status).toBe(200)
    expect(qa.body.source).toBe("IAINEG_pseudonymized_csv")
    expect(JSON.stringify(qa.body)).not.toContain("6282846E25D5")

    const overview = await request(app).get("/api/v1/analytics/overview").set(headers)
    expect(overview.status).toBe(200)
    expect(overview.body.snapshot.sourceKind).toBe("sandbox")
    expect(overview.body.snapshot.source).toMatch(/IAINEG/)
    expect(overview.body.bi.data.recordCount).toBe(3101)
    expect(overview.body.bi.data.revenue).toBeCloseTo(41223328.922, 3)

    // The provenance endpoint is admin-only, unlike the cross-platform KPI endpoint.
    const anon = await request(app).get("/api/v1/demo/database/quality")
    expect(anon.status).toBe(401)
    await deps.store.close()
    deps.erpDb?.close()
  })
})
