import { describe, expect, it } from "vitest"
import type { Dataset } from "../services.js"
import { analyzeRevenueGrowth } from "./revenue-growth.js"

const sample = (): Dataset => ({
  metadata: {
    adapter: "test",
    source: "Fixture de test synthétique",
    currency: "TND",
    asOf: "2026-10-31",
    lastUpdated: "2026-10-31T00:00:00.000Z",
  },
  receivables: [],
  inventory: [],
  sales: [
    { id: "1", invoiceId: "FV-001", date: "2026-06-15", agency: "Sfax", customerId: "c1", customer: "Client A", product: "A", family: "B", representative: "Rep", revenue: 1000, cost: 700, status: "posted" },
    { id: "2", invoiceId: "FV-002", date: "2026-09-20", agency: "Sfax", customerId: "c1", customer: "Client A", product: "A", family: "B", representative: "Rep", revenue: 2000, cost: 1100, status: "posted" },
    { id: "3", invoiceId: "FV-003", date: "2026-06-18", agency: "Sfax", customerId: "c2", customer: "Client B", product: "B", family: "B", representative: "Rep", revenue: 7000, cost: 4500, status: "posted" },
    { id: "4", invoiceId: "FV-004", date: "2026-08-01", agency: "Tunis Centre", customerId: "c3", customer: "Secret Tunis", product: "B", family: "B", representative: "Rep", revenue: 500000, cost: 100, status: "posted" },
    { id: "5", invoiceId: "FV-005", date: "2026-10-01", agency: "Sfax", customerId: "c4", customer: "Client sans cout", product: "C", family: "B", representative: "Rep", revenue: 200, cost: null, status: "posted" },
    { id: "6", invoiceId: "FV-006", date: "2026-10-06", agency: "Sfax", customerId: "c5", customer: "Facture annulee", product: "C", family: "B", representative: "Rep", revenue: 300000, cost: 200, status: "cancelled" },
    { id: "7", invoiceId: "AV-001", date: "2026-10-07", agency: "Sfax", customerId: "c1", customer: "Client A", product: "A", family: "B", representative: "Rep", revenue: -100, cost: -40, kind: "credit_note", status: "posted" },
  ],
})

describe("Revenue Growth Agent — read-only deterministic core", () => {
  it("compares consecutive non-overlapping 90-day windows and respects agency isolation", () => {
    const result = analyzeRevenueGrowth({ scope: ["Sfax"], dataset: sample() })
    expect(result.status).toBe("ok")
    expect(result.snapshot.current.to).toBe("2026-10-31")
    expect(result.snapshot.current.from).toBe("2026-08-03")
    expect(result.snapshot.previous.to).toBe("2026-08-02")
    expect(result.analysis.customersAnalyzed).toBe(3)
    expect(result.opportunities.some((r) => r.customerName === "Secret Tunis")).toBe(false)
    expect(result.opportunities.some((r) => r.customerName === "Facture annulee")).toBe(false)
    const growing = result.opportunities.find((r) => r.customerId === "c1")
    expect(growing?.state).toBe("growing")
    expect(growing?.metrics.currentRevenueTnd).toBe(1900)
    expect(growing?.metrics.previousRevenueTnd).toBe(1000)
    expect(growing?.metrics.growthPercent).toBe(90)
    expect(growing?.evidence.invoiceIds).toContain("AV-001")
    expect(growing?.proposedAction.status).toBe("draft_only")
  })

  it("detects dormant customers and never treats missing cost as zero", () => {
    const result = analyzeRevenueGrowth({ scope: ["Sfax"], dataset: sample() })
    expect(result.opportunities.find((r) => r.customerId === "c2")?.state).toBe("dormant")
    const missing = result.opportunities.find((r) => r.customerId === "c4")
    expect(missing?.metrics.currentMargin.amount).toBeNull()
    expect(missing?.warnings.join(" ")).toContain("Marge indisponible")
  })

  it("returns empty evidence without inventing opportunities", () => {
    const result = analyzeRevenueGrowth({ scope: ["Kairouan"], dataset: sample() })
    expect(result.status).toBe("no_data")
    expect(result.opportunities).toEqual([])
    expect(result.analysis.customersAnalyzed).toBe(0)
  })

  it("denies invalid analysis windows and limits", () => {
    expect(() => analyzeRevenueGrowth({ scope: "*", dataset: sample(), windowDays: 0 })).toThrow()
    expect(() => analyzeRevenueGrowth({ scope: "*", dataset: sample(), limit: 200 })).toThrow()
  })

  it("keeps customers with shared display names distinct via stable customer IDs", () => {
    const data = sample()
    data.sales.push({ id: "8", invoiceId: "FV-008", date: "2026-09-01", agency: "Sfax", customerId: "c7", customer: "Client A", product: "A", family: "B", representative: "Rep", revenue: 300, cost: 200, status: "posted" })
    const result = analyzeRevenueGrowth({ scope: ["Sfax"], dataset: data })
    expect(result.opportunities.filter((r) => r.customerName === "Client A")).toHaveLength(2)
  })
})
