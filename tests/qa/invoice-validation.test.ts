// Invoice anomaly fixtures (fixtures/adverse/invoices) run through the application's
// invoice validation rules — the gate applied before a reviewed extraction can be approved.
import fs from "node:fs"
import { afterAll, describe, expect, it } from "vitest"

type Case = { id: string; invoice: Record<string, unknown>; expectedCodes: string[]; expectedBehaviour: string }
const fx: { registeredInvoices: { supplierId: string; invoiceNumber: string }[]; knownPurchaseOrders: string[]; cases: Case[] } = JSON.parse(fs.readFileSync("fixtures/adverse/invoices/invoice_anomalies.json", "utf8"))
const results: { id: string; expected: string[]; actual: string[] | string; exact: boolean }[] = []

async function validator() {
  const modPath = "../../server/invoice-validation.js"
  try {
    return (await import(/* @vite-ignore */ modPath)) as { validateInvoice: (inv: unknown, ctx: unknown) => { code: string }[] }
  } catch {
    return undefined
  }
}

afterAll(() => {
  const tp = results.reduce((s, r) => s + (Array.isArray(r.actual) ? r.expected.filter((c) => r.actual.includes(c)).length : 0), 0)
  const fn = results.reduce((s, r) => s + (Array.isArray(r.actual) ? r.expected.filter((c) => !r.actual.includes(c)).length : r.expected.length), 0)
  const fp = results.reduce((s, r) => s + (Array.isArray(r.actual) ? (r.actual as string[]).filter((c) => !r.expected.includes(c)).length : 0), 0)
  fs.writeFileSync(`reports/evidence/invoice_validation_${process.env.QA_PHASE ?? "adhoc"}.json`, JSON.stringify({ cases: results.length, exactCases: results.filter((r) => r.exact).length, truePositives: tp, falseNegatives: fn, falsePositives: fp, detectionRate: tp + fn ? tp / (tp + fn) : null, results }, null, 2))
})

describe("invoice anomaly detection", () => {
  for (const c of fx.cases) {
    it(`${c.id}: ${c.expectedBehaviour}`, async () => {
      const v = await validator()
      if (!v) {
        results.push({ id: c.id, expected: c.expectedCodes, actual: "NO VALIDATION MODULE", exact: false })
        expect.fail("server/invoice-validation.ts does not exist: the application performs no invoice validation")
      }
      const codes = [...new Set(v!.validateInvoice(c.invoice, { registeredInvoices: fx.registeredInvoices, knownPurchaseOrders: fx.knownPurchaseOrders, vatRates: [0, 7, 13, 19], currency: "TND" }).map((x) => x.code))].sort()
      results.push({ id: c.id, expected: c.expectedCodes, actual: codes, exact: JSON.stringify(codes) === JSON.stringify(c.expectedCodes) })
      expect(codes).toEqual(c.expectedCodes)
    })
  }
})
