import { describe, expect, it } from "vitest"
import request from "supertest"
import { analyticsOverviewSchema, platformContextSchema } from "../shared/contracts/analytics-platform.js"
import { bearer, makeApp } from "../tests/qa/support/harness.js"
import { hasPermission, permissionsForRole } from "./permissions.js"
import { defaultDataset, overview as computeBiOverview } from "./services.js"

describe("shared analytics permissions", () => {
  it.each([
    ["admin", ["analytics.bi.read", "analytics.ds.read", "agentic.read"]],
    ["manager", ["analytics.bi.read", "analytics.ds.read", "agentic.read"]],
    ["accountant", ["analytics.bi.read", "analytics.ds.read"]],
    ["commercial", ["analytics.bi.read", "agentic.read"]],
  ] as const)("grants least-privilege analytics access to %s", (role, expected) => {
    const actual = permissionsForRole(role).filter((permission) =>
      permission.startsWith("analytics.") || permission === "agentic.read",
    )
    expect(actual).toEqual(expected)
    for (const permission of expected) expect(hasPermission(role, permission)).toBe(true)
  })
})

describe("analytics platform API", () => {
  it("requires authentication", async () => {
    const { app } = makeApp()
    expect((await request(app).get("/api/v1/platform/context")).status).toBe(401)
    expect((await request(app).get("/api/v1/analytics/overview")).status).toBe(401)
  })

  it("exposes a truthful, contract-valid platform context", async () => {
    const { app } = makeApp()
    const response = await request(app).get("/api/v1/platform/context").set(bearer("dev-manager-sfax"))
    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(platformContextSchema.safeParse(response.body).success).toBe(true)
    expect(response.body.principal.agencies).toEqual(["Sfax"])
    expect(response.body.platforms.dataScience).toEqual({
      status: "available",
      modelServingVerified: false,
    })
  })

  it("returns one scoped snapshot without claiming model serving", async () => {
    const { app, store } = makeApp()
    const first = await request(app)
      .get("/api/v1/analytics/overview?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    const second = await request(app)
      .get("/api/v1/analytics/overview?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    expect(first.status).toBe(200)
    expect(first.headers["cache-control"]).toBe("no-store")
    expect(analyticsOverviewSchema.safeParse(first.body).success).toBe(true)
    expect(first.body.scope).toEqual(["Sfax"])
    expect(first.body.snapshot).toMatchObject({
      sourceKind: "sandbox",
      isSynthetic: true,
    })
    expect(first.body.warnings).toContain(
      "DEMONSTRATION : donnees entierement fictives. Aucune connexion, lecture ou ecriture ERP.",
    )
    expect(first.body.snapshotId).toBe(second.body.snapshotId)
    expect(first.body.insights.summary.revenue).toBe(first.body.bi.data.revenue)
    expect(first.body.insights.summary.documentCount).toBe(first.body.bi.data.recordCount)
    expect(first.body.insights.currency).toBe("TND")
    expect(first.body.insights.coverage.modelServingVerified).toBe(false)
    expect(first.body.dataScience.status).toBe("available")
    expect(first.body.dataScience.modelServingVerified).toBe(false)
    expect(first.body.dataScience.predictions).toEqual([])
    expect(first.body.dataScience.analysis.version).toBe("ds-scoped-v1")
    expect(first.body.dataScience.analysis.scenarios.basisRevenueTnd).toBe(first.body.bi.data.revenue)
    expect(first.body.dataScience.analysis.portfolio.customers).toBe(first.body.insights.summary.customerCount)
    expect(first.body.dataScience.analysis.forecast.verifiedProduction).toBe(false)
    expect(store.audits.some((event) => event.action === "analytics.overview.viewed")).toBe(true)
  })

  it("serves detailed BI modules that reconcile with the scoped KPI snapshot", async () => {
    const { app } = makeApp()
    const res = await request(app).get("/api/v1/analytics/overview?agency=Sfax").set(bearer("dev-manager-sfax"))
    expect(res.status).toBe(200)
    expect(analyticsOverviewSchema.safeParse(res.body).success).toBe(true)
    const bi = res.body.bi.data, modules = res.body.insights.modules
    const millimes = (n: number) => Math.round(n * 1000)
    for (const key of ["articles", "margin", "stock", "receivables", "cash"])
      expect(["observed", "observed_current_snapshot", "not_available"]).toContain(modules[key].status)
    if (modules.receivables.status === "observed") {
      expect(modules.receivables.outstanding).toBe(bi.receivables)
      expect(modules.receivables.overdue).toBe(bi.overdue)
    }
    if (modules.margin.status === "observed")
      expect(modules.margin.byFamily.reduce((n: number, f: { margin: number }) => n + millimes(f.margin), 0))
        .toBe(millimes(bi.grossMargin))
    if (modules.stock.status === "observed_current_snapshot") {
      expect(modules.stock.totalValue).toBe(bi.inventoryValue)
      expect(modules.stock.topByValue.every((r: { agency: string }) => r.agency === "Sfax")).toBe(true)
    }
    if (modules.articles.status === "observed")
      expect(modules.articles.topProducts.length).toBeGreaterThan(0)
  })

  it("never presents a past-period stock as observed", async () => {
    const { app } = makeApp()
    const res = await request(app).get("/api/v1/analytics/overview?from=2020-01-01&to=2020-01-31").set(bearer("dev-admin"))
    expect(res.status).toBe(200)
    expect(res.body.insights.modules.stock.status).toBe("not_available")
  })

  it("fails closed for another agency and another tenant", async () => {
    const { app } = makeApp()
    const agency = await request(app)
      .get("/api/v1/analytics/overview?agency=Tunis%20Centre")
      .set(bearer("dev-manager-sfax"))
    expect(agency.status).toBe(403)
    expect(agency.body.error.code).toBe("AGENCY_FORBIDDEN")

    const tenant = await request(app)
      .get("/api/v1/analytics/overview")
      .set(bearer("dev-admin-org-b"))
    expect(tenant.status).toBe(403)
    expect(tenant.body.error.code).toBe("ERP_SOURCE_UNAVAILABLE")
  })


  it("keeps agency and period snapshots consistent with the governed BI calculator", async () => {
    const { app } = makeApp()
    const periods = [
      { from: "2026-07-01", to: "2026-09-30" },
      { from: "2026-10-01", to: "2026-12-31" },
    ]
    const snapshots: string[] = []
    for (const period of periods) {
      const response = await request(app).get("/api/v1/analytics/overview")
        .query({ agency: "Sfax", ...period })
        .set(bearer("dev-manager-sfax"))
      expect(response.status).toBe(200)
      expect(analyticsOverviewSchema.safeParse(response.body).success).toBe(true)
      expect(response.body.scope).toEqual(["Sfax"])
      expect(response.body.bi.data.filters.from).toBe(period.from)
      expect(response.body.bi.data.filters.to).toBe(period.to)
      expect(response.body.bi.data.revenue).toBe(
        computeBiOverview({ agencies: ["Sfax"], ...period }, defaultDataset()).revenue,
      )
      expect(response.body.bi.data.receivables).toBe(
        computeBiOverview({ agencies: ["Sfax"], ...period }, defaultDataset()).receivables,
      )
      expect(response.body.dataScience.modelServingVerified).toBe(false)
      expect(response.body.dataScience.analysis.scenarios.basisRevenueTnd)
        .toBe(response.body.bi.data.recordCount>0 ? response.body.bi.data.revenue : null)
      expect(response.body.dataScience.analysis.trend.months).toEqual(response.body.insights.months)
      expect(response.body.agentic.availableAgents).toHaveLength(4)
      snapshots.push(response.body.snapshotId)
    }
    expect(snapshots[0]).not.toBe(snapshots[1])
    const denied = await request(app).get("/api/v1/analytics/overview")
      .query({ agency: "Tunis Centre", ...periods[0] })
      .set(bearer("dev-manager-sfax"))
    expect(denied.status).toBe(403)
    const commercial=await request(app).get("/api/v1/analytics/overview?agency=Tunis%20Centre")
      .set(bearer("dev-commercial-tunis"))
    expect(commercial.status).toBe(200)
    expect(commercial.body.dataScience.status).toBe("forbidden")
    expect(commercial.body.dataScience.analysis).toBeUndefined()
  })

  it("returns identical BI revenue and DS/Agentic forecast from one agency-period dataset",async()=>{
    const {app}=makeApp()
    const filters={agency:"Sfax",from:"2025-01-01",to:"2025-12-31"}
    const overview=await request(app).get("/api/v1/analytics/overview")
      .query(filters).set(bearer("dev-manager-sfax"))
    const agentic=await request(app).get("/api/v1/agentic/workspace/predictions")
      .query(filters).set(bearer("dev-manager-sfax"))
    expect(overview.status).toBe(200)
    expect(agentic.status).toBe(200)
    const ds=overview.body.dataScience.analysis
    expect(ds.source).toBe(overview.body.snapshot.source)
    expect(ds.scenarios.basisRevenueTnd).toBe(overview.body.bi.data.revenue)
    expect(ds.trend.months).toEqual(overview.body.insights.months)
    expect(ds.forecast.status).toBe(agentic.body.status)
    expect(ds.forecast.predictions).toEqual(agentic.body.predictions)
    expect(ds.forecast.modelVersion).toBe(agentic.body.model.version)
    expect(overview.body.dataScience.modelServingVerified).toBe(false)
  })

  it("rejects invalid periods", async () => {
    const { app } = makeApp()
    const response = await request(app)
      .get("/api/v1/analytics/overview?from=2026-12-31&to=2026-01-01")
      .set(bearer("dev-admin"))
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("INVALID_REQUEST")
  })
})
