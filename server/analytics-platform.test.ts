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
      status: "not_configured",
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
    expect(first.body.snapshotId).toBe(second.body.snapshotId)
    expect(first.body.insights.summary.revenue).toBe(first.body.bi.data.revenue)
    expect(first.body.insights.summary.documentCount).toBe(first.body.bi.data.recordCount)
    expect(first.body.insights.currency).toBe("TND")
    expect(first.body.insights.coverage.modelServingVerified).toBe(false)
    expect(first.body.dataScience).toEqual({
      status: "not_configured",
      modelServingVerified: false,
      predictions: [],
    })
    expect(store.audits.some((event) => event.action === "analytics.overview.viewed")).toBe(true)
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
      expect(response.body.agentic.availableAgents).toHaveLength(4)
      snapshots.push(response.body.snapshotId)
    }
    expect(snapshots[0]).not.toBe(snapshots[1])
    const denied = await request(app).get("/api/v1/analytics/overview")
      .query({ agency: "Tunis Centre", ...periods[0] })
      .set(bearer("dev-manager-sfax"))
    expect(denied.status).toBe(403)
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
