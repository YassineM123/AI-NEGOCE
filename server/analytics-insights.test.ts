import { describe, expect, it } from "vitest"
import { buildAnalyticsInsights } from "./analytics-insights.js"
import { defaultDataset, overview } from "./services.js"

describe("shared governed BI / Data Science insights", () => {
  it("reconciles monthly sales and customers with the scoped overview", () => {
    const data = defaultDataset()
    const filters = { agencies: ["Sfax"], from: "2025-01-01", to: "2025-02-28" }
    const result = buildAnalyticsInsights(data, filters)
    expect(result.summary.revenue).toBe(overview(filters, data).revenue)
    expect(result.summary.documentCount).toBe(overview(filters, data).recordCount)
    expect(result.summary.documentCount).toBe(2)
    expect(result.summary.customerCount).toBe(2)
    expect(result.months.map((m) => m.month)).toEqual(["2025-01", "2025-02"])
    expect(result.months.reduce((n, m) => n + Math.round(m.revenue * 1000), 0))
      .toBe(Math.round(result.summary.revenue * 1000))
    expect(result.topCustomers.every((c) => c.lastPurchase <= result.referenceDate)).toBe(true)
    expect(result.coverage.costMissingRows).toBe(0)
    expect(result.coverage.modelServingVerified).toBe(false)
  })

  it("fails closed on a period without sales rather than generating a forecast", () => {
    const result = buildAnalyticsInsights(defaultDataset(), {
      agencies: ["Sfax"], from: "2026-10-01", to: "2026-12-31",
    })
    expect(result.summary.revenue).toBe(0)
    expect(result.summary.documentCount).toBe(0)
    expect(result.months).toEqual([])
    expect(result.topCustomers).toEqual([])
    expect(result.summary.monthlyChangePercent).toBeNull()
  })

  it("discloses missing extract fields and never invents receivables or costs", () => {
    const base = defaultDataset()
    const data = {
      ...base,
      metadata: { ...base.metadata, source: "IAINEG / Database/extractions" },
      sales: base.sales.map((row) => ({ ...row, agency: "Non ventilée (extraction)", cost: null })),
      receivables: [],
      inventory: [],
    }
    const result = buildAnalyticsInsights(data, { agencies: "*" })
    expect(result.coverage.costMissingRows).toBe(data.sales.length)
    expect(result.coverage.receivablesAvailable).toBe(false)
    expect(result.coverage.inventoryValuationAvailable).toBe(false)
    expect(result.coverage.agencyAttributionAvailable).toBe(false)
    expect(result.summary.revenue).toBe(overview({ agencies: "*" }, data).revenue)
  })
})
