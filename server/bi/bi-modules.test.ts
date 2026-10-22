import { beforeAll, describe, expect, it } from "vitest"
import { ErpDatabase } from "../erp-db.js"
import {
  computeExecutiveCockpit,
  computeSalesIntelligence,
  computeProfitability,
  computePurchases,
  computeInventory,
  computeFinance,
  computeDiagnostics,
  computeAlerts,
  acknowledgeAlert,
  computeForecasting,
  generateExportReport,
} from "./index.js"

describe("BI 360 Enterprise Modules A-J (ERP Sandbox Verification)", () => {
  let db: ErpDatabase | null

  beforeAll(() => {
    db = ErpDatabase.open()
  })

  it("opens the local ERP database", () => {
    expect(db).not.toBeNull()
    expect(db!.asOf()).toBeDefined()
  })

  it("Module A - Executive Cockpit computes all 14 KPIs and agency breakdown", () => {
    const res = computeExecutiveCockpit(db!, "*", { period: "year" })
    expect(res).toBeDefined()
    expect(res.kpis.revenueHt.value).toBeGreaterThan(0)
    expect(res.kpis.grossMargin.value).toBeGreaterThan(0)
    expect(res.kpis.markupRate.value).toBeGreaterThan(0)
    expect(res.kpis.marginRate.value).toBeGreaterThan(0)
    expect(res.kpis.purchasesHt.value).toBeGreaterThan(0)
    expect(res.kpis.receivablesTotal.value).toBeGreaterThan(0)
    expect(res.kpis.inventoryValuation.value).toBeGreaterThan(0)
    expect(res.agenciesPerformance.length).toBeGreaterThan(0)
    expect(res.monthlyTrend.length).toBe(12)
  })

  it("Module B - Sales Intelligence computes customer Pareto and product rankings", () => {
    const res = computeSalesIntelligence(db!, "*", { period: "year" })
    expect(res.kpis.totalSalesHt).toBeGreaterThan(0)
    expect(res.topCustomers.length).toBeGreaterThan(0)
    expect(res.paretoCustomers.length).toBeGreaterThan(0)
    expect(res.topProducts.length).toBeGreaterThan(0)
    expect(res.salesByRep.length).toBeGreaterThan(0)
    expect(res.customerSegments.length).toBeGreaterThan(0)
  })

  it("Module C - Profitability Intelligence computes 4-factor margin waterfall", () => {
    const res = computeProfitability(db!, "*", { period: "year" })
    expect(res.kpis.grossMargin).toBeGreaterThan(0)
    expect(res.waterfallBridge.factors.length).toBe(4)
    expect(res.marginByCategory.length).toBeGreaterThan(0)
    expect(res.marginByCustomer.length).toBeGreaterThan(0)
  })

  it("Module D - Purchases & Suppliers computes supplier concentration and PO stats", () => {
    const res = computePurchases(db!, "*", { period: "year" })
    expect(res.kpis.totalPurchasesHt).toBeGreaterThan(0)
    expect(res.topSuppliers.length).toBeGreaterThan(0)
    expect(res.supplierConcentrationPareto.length).toBeGreaterThan(0)
  })

  it("Module E - Inventory Intelligence computes ABC and XYZ classification", () => {
    const res = computeInventory(db!, "*", {})
    expect(res.kpis.totalValuation).toBeGreaterThan(0)
    expect(res.abcClassification.length).toBe(3)
    expect(res.xyzDemandAnalysis.length).toBe(3)
    expect(res.valuationByAgency.length).toBeGreaterThan(0)
  })

  it("Module F - Finance & Receivables computes aging buckets (0-30, 31-60, 61-90, 90+)", () => {
    const res = computeFinance(db!, "*", { period: "year" })
    expect(res.kpis.totalReceivables).toBeGreaterThan(0)
    expect(res.agingBuckets.length).toBe(4)
    expect(res.topDebtorCustomers.length).toBeGreaterThan(0)
  })

  it("Module G - Advanced Diagnostics provides deterministic root-cause decomposition", () => {
    const res = computeDiagnostics(db!, "*", { period: "year" })
    expect(res.diagnostics.length).toBe(3)
    expect(res.diagnostics[0].confidence).toBe("deterministic")
  })

  it("Module H - Business Alert Center detects alerts and supports acknowledgment", () => {
    const res = computeAlerts(db!, "*", true)
    expect(res.alerts.length).toBeGreaterThan(0)
    const firstAlert = res.alerts[0]
    expect(acknowledgeAlert(firstAlert.id)).toBe(true)

    // Unacknowledged should not include it
    const active = computeAlerts(db!, "*", false)
    expect(active.alerts.some((a) => a.id === firstAlert.id)).toBe(false)
  })

  it("Module I - Forecasting & Simulations projects time-series with confidence bounds", () => {
    const res = computeForecasting(db!, "*", {})
    expect(res.salesForecast.length).toBeGreaterThan(12)
    expect(res.simulations.priceSensitivity.length).toBe(4)
    expect(res.simulations.costInflationSensitivity.length).toBe(4)
  })

  it("Module J - Reporting exports multi-section corporate CSV report", () => {
    const csv = generateExportReport(db!, "*", { period: "year" }, { format: "csv" })
    expect(typeof csv).toBe("string")
    expect(csv).toContain("AI-NÉGOCE / NEXORA")
    expect(csv).toContain("VUE EXÉCUTIVE")
    expect(csv).toContain("PERFORMANCE PAR AGENCE")
  })

  it("respects agency scope restriction (e.g. Sfax only)", () => {
    const all = computeExecutiveCockpit(db!, "*", { period: "year" })
    const sfax = computeExecutiveCockpit(db!, ["Sfax"], { period: "year" })
    expect(sfax.kpis.revenueHt.value).toBeLessThan(all.kpis.revenueHt.value)
  })
})
