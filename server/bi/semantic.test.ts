import { describe, expect, it } from "vitest"
import {
  METRIC_CATALOG,
  calcPctChange,
  fromM,
  round1,
  round3,
  safeDiv,
  safePct,
  toM,
} from "./semantic.js"

describe("BI Semantic Layer - Mathematical & Metric Verification", () => {
  it("METRIC_CATALOG contains authoritative entries for core KPIs", () => {
    expect(METRIC_CATALOG.KPI_REV_HT).toBeDefined()
    expect(METRIC_CATALOG.KPI_GROSS_MARGIN).toBeDefined()
    expect(METRIC_CATALOG.KPI_MARKUP_RATE).toBeDefined()
    expect(METRIC_CATALOG.KPI_MARGIN_RATE).toBeDefined()
    expect(METRIC_CATALOG.KPI_PURCHASES_HT).toBeDefined()
    expect(METRIC_CATALOG.KPI_RECEIVABLES_TOTAL).toBeDefined()
    expect(METRIC_CATALOG.KPI_DSO).toBeDefined()
    expect(METRIC_CATALOG.KPI_INVENTORY_VALUATION).toBeDefined()
    expect(METRIC_CATALOG.KPI_DORMANT_INVENTORY).toBeDefined()

    // Verify formulas and units
    expect(METRIC_CATALOG.KPI_REV_HT.unit).toBe("DT")
    expect(METRIC_CATALOG.KPI_MARKUP_RATE.unit).toBe("%")
    expect(METRIC_CATALOG.KPI_MARGIN_RATE.unit).toBe("%")
    expect(METRIC_CATALOG.KPI_DSO.unit).toBe("j")
  })

  it("exact millime arithmetic preserves 3 decimals without binary drift", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004
    const a = 0.1
    const b = 0.2
    const sumM = toM(a) + toM(b)
    expect(fromM(sumM)).toBe(0.3)
    expect(round3(fromM(sumM))).toBe(0.3)
  })

  it("safeDiv and safePct protect against zero division and return clean percentages", () => {
    expect(safeDiv(100, 0)).toBeNull()
    expect(safeDiv(100, NaN)).toBeNull()
    expect(safePct(25, 100)).toBe(25.0)
    expect(safePct(1, 3)).toBe(33.3)
    expect(safePct(0, 500)).toBe(0.0)
    expect(safePct(500, 0)).toBeNull()
  })

  it("calcPctChange computes correct percentage variation", () => {
    expect(calcPctChange(120, 100)).toBe(20.0)
    expect(calcPctChange(80, 100)).toBe(-20.0)
    expect(calcPctChange(100, null)).toBeNull()
    expect(calcPctChange(100, 0)).toBeNull()
  })

  it("distinguishes Taux de marque from Taux de marge", () => {
    const revenue = 1000 // CA HT
    const cost = 600 // Coût de revient
    const margin = revenue - cost // 400 DT

    // Taux de marque = Marge / CA (40%)
    const markupRate = safePct(margin, revenue)
    // Taux de marge = Marge / Coût (66.7%)
    const marginRate = safePct(margin, cost)

    expect(markupRate).toBe(40.0)
    expect(marginRate).toBe(66.7)
    expect(markupRate).not.toBe(marginRate)
  })
})
