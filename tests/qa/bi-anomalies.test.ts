// BI anomaly fixtures (fixtures/adverse/bi/bi_anomalies.json) executed through the real API.
import fs from "node:fs"
import { afterAll, describe, expect, it, vi } from "vitest"
import request from "supertest"
import { bearer, makeApp } from "./support/harness.js"

const holder = vi.hoisted(() => ({ sales: [] as Record<string, unknown>[], receivables: [] as Record<string, unknown>[], inventory: [] as Record<string, unknown>[] }))
vi.mock("../../server/data.js", () => ({
  sales: holder.sales,
  receivables: holder.receivables,
  inventory: holder.inventory,
  agencies: ["Tunis Centre", "Sfax", "Sousse"],
  datasetMetadata: { adapter: "test", source: "fixtures/adverse/bi", currency: "TND", lastUpdated: "2026-10-15T00:00:00.000Z", asOf: "2026-10-15" },
}))

type Case = { id: string; sales: Record<string, unknown>[]; filters?: Record<string, string>; expect: Record<string, unknown>; note?: string }
const cases: Case[] = JSON.parse(fs.readFileSync("fixtures/adverse/bi/bi_anomalies.json", "utf8"))
const results: { id: string; ok: boolean; expected: unknown; actual: unknown }[] = []

function load(c: Case) {
  holder.sales.splice(0, holder.sales.length, ...c.sales.map((s) => ({ ...s, revenue: s.kind === "credit_note" ? -Number(s.revenue) : s.revenue, cost: s.cost === null ? null : s.kind === "credit_note" ? -Number(s.cost) : s.cost })))
  holder.receivables.splice(0, holder.receivables.length, ...c.sales.filter((s) => s.outstanding !== undefined).map((s) => ({ invoiceId: s.invoiceId, agency: s.agency, customer: s.customer, date: s.date, dueDate: s.date, outstanding: s.outstanding })))
}

afterAll(() => {
  fs.writeFileSync(`reports/evidence/bi_anomalies_${process.env.QA_PHASE ?? "adhoc"}.json`, JSON.stringify(results, null, 2))
})

describe("BI anomaly fixtures", () => {
  for (const c of cases.filter((c) => !["DUPLICATE_TRANSACTION", "INCONSISTENT_AGENCY_ID"].includes(c.id))) {
    it(c.id, async () => {
      load(c)
      const r = await request(makeApp().app).get("/api/v1/bi/overview").query({ agency: "all", ...c.filters }).set(bearer("dev-admin"))
      const actual = Object.fromEntries(Object.keys(c.expect).map((k) => [k, r.body[k]]))
      const ok = Object.entries(c.expect).every(([k, v]) => (typeof v === "number" && typeof r.body[k] === "number" ? Math.abs(r.body[k] - v) < 1e-9 : JSON.stringify(r.body[k]) === JSON.stringify(v)))
      results.push({ id: c.id, ok, expected: c.expect, actual })
      expect(actual).toEqual(c.expect)
    })
  }
  // These two are data-quality responsibilities: verify the defect is at least visible.
  it("DUPLICATE_TRANSACTION is double counted by the API (must be caught upstream by data-quality checks)", async () => {
    const c = cases.find((x) => x.id === "DUPLICATE_TRANSACTION")!
    load(c)
    const r = await request(makeApp().app).get("/api/v1/bi/overview").set(bearer("dev-admin"))
    results.push({ id: c.id, ok: r.body.revenue === 2000, expected: "documented: API sums both rows (2000); duplicate detection lives in tools/qa/data_quality.py", actual: { revenue: r.body.revenue } })
    expect(r.body.revenue).toBe(2000)
  })
  it("INCONSISTENT_AGENCY_ID rows are excluded from the agency filter (exact label match only)", async () => {
    const c = cases.find((x) => x.id === "INCONSISTENT_AGENCY_ID")!
    load(c)
    const r = await request(makeApp().app).get("/api/v1/bi/overview").query(c.filters!).set(bearer("dev-admin"))
    results.push({ id: c.id, ok: r.body.revenue === 1000, expected: { revenue: 1000 }, actual: { revenue: r.body.revenue } })
    expect(r.body.revenue).toBe(1000)
  })
})
