// Phase 1 / Step 4 — exact financial calculations: decimal arithmetic, rounding boundaries,
// configurable invoice rules, deterministic validation, and the rules-based approval gate.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { Decimal, DecimalError, dec, sum, type RoundingMode } from "../../server/money.js"
import {
  DEMO_FINANCIAL_RULES,
  computeInvoice,
  convertQuantity,
  financialRulesSchema,
  rulesUsable,
  type FinancialRules,
} from "../../server/financial-rules.js"
import { validateInvoice, type InvoiceInput } from "../../server/invoice-validation.js"
import { AUDIENCE, ISSUER, PDF, StubOcr, bearer, makeApp, startIssuer } from "./support/harness.js"

const rules = (over: Partial<FinancialRules> = {}): FinancialRules => ({ ...DEMO_FINANCIAL_RULES, ...over })
const codes = (inv: InvoiceInput, r: FinancialRules) => validateInvoice(inv, { rules: r }).map((i) => i.code).sort()

describe("Decimal parsing", () => {
  it.each(["0", "12", "-3", "0.5", "1234.567", "+7.25", "000.100"])("accepts %s", (v) => {
    expect(() => dec(v)).not.toThrow()
  })
  it.each(["", " ", "1 234,5", "1,5", "1.", ".5", "--1", "1e3", "0x10", "abc", "12.3.4", "1".padEnd(3, "0") + "." + "1".repeat(19)])("refuses %j", (v) => {
    expect(() => dec(v)).toThrow(DecimalError)
  })
  it("refuses non-finite and exponent numbers, keeps the literal of finite ones", () => {
    expect(() => dec(Number.NaN)).toThrow()
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => dec(1e-7)).toThrow()
    expect(dec(9.5).toString()).toBe("9.5")
    expect(dec(50).toString()).toBe("50")
  })
  it("tryParse returns undefined instead of throwing", () => {
    expect(Decimal.tryParse(undefined)).toBeUndefined()
    expect(Decimal.tryParse("x")).toBeUndefined()
    expect(Decimal.tryParse({})).toBeUndefined()
  })
})

describe("exact arithmetic where binary floating point fails", () => {
  it("0.1 + 0.2 = 0.3 and ten times 0.1 = 1", () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(dec("0.1").add(dec("0.2")).eq(dec("0.3"))).toBe(true)
    expect(sum(Array(10).fill(dec("0.1"))).eq(dec("1"))).toBe(true)
  })
  it("1.005 rounds to 1.01 (half up), where Math.round(1.005 * 100) / 100 gives 1", () => {
    expect(Math.round(1.005 * 100) / 100).toBe(1)
    expect(dec("1.005").round(2, "half_up").toString()).toBe("1.01")
  })
  it("multiplies large amounts without loss", () => {
    expect(dec("999999999999.999").mul(dec("1000")).toString()).toBe("999999999999999.000")
    expect(dec("123456789.123").mul(dec("0.19")).toString()).toBe("23456789.93337")
  })
  it("percentages are exact", () => {
    expect(dec("740").percent(dec("19")).toString()).toBe("140.60")
    expect(dec("0.010").percent(dec("7")).toString()).toBe("0.00070")
  })
  it("compares across scales", () => {
    expect(dec("1.50").eq(dec("1.5"))).toBe(true)
    expect(dec("-0.001").cmp(dec("0"))).toBe(-1)
    expect(dec("0.000").isZero()).toBe(true)
  })
})

describe("rounding boundaries", () => {
  const cases: [string, number, RoundingMode, string][] = [
    ["2.5", 0, "half_up", "3"], ["-2.5", 0, "half_up", "-3"], ["2.4999", 0, "half_up", "2"],
    ["2.5", 0, "half_even", "2"], ["3.5", 0, "half_even", "4"], ["-2.5", 0, "half_even", "-2"],
    ["0.0005", 3, "half_up", "0.001"], ["0.0004999", 3, "half_up", "0.000"], ["-0.0005", 3, "half_up", "-0.001"],
    ["0.0015", 3, "half_even", "0.002"], ["0.0025", 3, "half_even", "0.002"], ["0.00250001", 3, "half_even", "0.003"],
    ["1.2345", 3, "half_up", "1.235"], ["1.2344999", 3, "half_up", "1.234"],
    ["2.999", 2, "down", "2.99"], ["-2.999", 2, "down", "-2.99"],
    ["2.001", 2, "up", "2.01"], ["-2.001", 2, "up", "-2.01"], ["2.000", 2, "up", "2.00"],
    ["7", 3, "half_up", "7.000"], ["0.5", 0, "half_up", "1"], ["0.49", 0, "half_up", "0"],
  ]
  it.each(cases)("%s at %i decimals, %s -> %s", (v, scale, mode, expected) => {
    expect(dec(v).round(scale, mode).toString()).toBe(expected)
  })
  it("divides with explicit rounding", () => {
    expect(dec("10").div(dec("3"), 3, "half_up").toString()).toBe("3.333")
    expect(dec("2").div(dec("3"), 3, "half_up").toString()).toBe("0.667")
    expect(dec("-2").div(dec("3"), 3, "half_up").toString()).toBe("-0.667")
    expect(dec("1").div(dec("8"), 2, "half_even").toString()).toBe("0.12")
    expect(dec("1").div(dec("8"), 2, "half_up").toString()).toBe("0.13")
    expect(dec("1").div(dec("-8"), 2, "half_up").toString()).toBe("-0.13")
    expect(() => dec("1").div(dec("0"), 2, "half_up")).toThrow()
  })
  it("formats and refuses lossy fixed output", () => {
    expect(dec("0.005").toString()).toBe("0.005")
    expect(dec("-0.05").toString()).toBe("-0.05")
    expect(dec("12.3").toFixed(3)).toBe("12.300")
    expect(() => dec("12.3456").toFixed(3)).toThrow()
  })
})

describe("invoice computation", () => {
  const baseline = [
    { quantity: 50, unitPrice: "9.500", vatRate: 7 },
    { quantity: 4, unitPrice: "185.000", vatRate: 19 },
  ]
  it("reproduces the reference invoice totals", () => {
    const r = computeInvoice(baseline, [], rules(), "1.000")
    expect([r.totalHt, r.totalVat, r.stamp, r.totalTtc].map((d) => d.toString())).toEqual(["1215.000", "173.850", "1.000", "1389.850"])
  })
  it("line-level and document-level VAT rounding differ, as configured", () => {
    const tiny = [1, 2, 3].map(() => ({ quantity: 1, unitPrice: "0.010", vatRate: 7 }))
    expect(computeInvoice(tiny, [], rules({ vatRounding: "line" })).totalVat.toString()).toBe("0.003")
    expect(computeInvoice(tiny, [], rules({ vatRounding: "document" })).totalVat.toString()).toBe("0.002")
  })
  it("applies percentage and amount discounts exactly", () => {
    const [pct] = computeInvoice([{ quantity: 3, unitPrice: "33.333", discountPct: 10, vatRate: 19 }], [], rules()).lines
    expect(pct.gross.toString()).toBe("99.999")
    expect(pct.ht.toString()).toBe("89.999") // 99.999 - 9.9999 = 89.9991
    const [both] = computeInvoice([{ quantity: 2, unitPrice: "50", discountPct: "5", discountAmount: "1.250", vatRate: 19 }], [], rules()).lines
    expect(both.ht.toString()).toBe("93.750")
  })
  it("includes additional charges with their own VAT", () => {
    const r = computeInvoice(baseline, [{ label: "Transport", amount: "15.000", vatRate: 19 }], rules(), "1.000")
    expect(r.totalHt.toString()).toBe("1230.000")
    expect(r.totalVat.toString()).toBe("176.700")
    expect(r.totalTtc.toString()).toBe("1407.700")
  })
  it("uses the configured stamp duty only when the invoice gives none", () => {
    expect(computeInvoice(baseline, [], rules({ stampDuty: "1.000" })).stamp.toString()).toBe("1.000")
    expect(computeInvoice(baseline, [], rules({ stampDuty: null })).stamp.toString()).toBe("0.000")
  })
  it("respects the configured money scale and rounding mode", () => {
    const line = [{ quantity: 3, unitPrice: "0.335", vatRate: 0 }]
    expect(computeInvoice(line, [], rules({ moneyScale: 2, roundingMode: "half_up" })).totalHt.toString()).toBe("1.01")
    expect(computeInvoice(line, [], rules({ moneyScale: 2, roundingMode: "half_even" })).totalHt.toString()).toBe("1.00")
    expect(computeInvoice(line, [], rules({ moneyScale: 2, roundingMode: "down" })).totalHt.toString()).toBe("1.00")
  })
  it("converts purchase units to stock units exactly", () => {
    expect(convertQuantity(3, "100", rules()).toString()).toBe("300.000")
    expect(convertQuantity("2.5", "0.333333", rules()).toString()).toBe("0.833")
    expect(convertQuantity("12", "0.25", rules({ quantityScale: 0, roundingMode: "half_up" })).toString()).toBe("3")
    expect(() => convertQuantity(3, "0", rules())).toThrow()
    expect(() => convertQuantity(3, "-1", rules())).toThrow()
  })
})

describe("validation with organization rules", () => {
  const invoice = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
    supplierId: "SUP-1",
    invoiceNumber: "FA-1",
    currency: "TND",
    lines: [{ description: "Ramette", quantity: 50, unitPrice: "9.500", discountPct: 0, vatRate: 7, lineHt: "475.000", lineVat: "33.250" }],
    totals: { ht: "475.000", vat: "33.250", stamp: "1.000", ttc: "509.250" },
    ...over,
  })
  it("accepts an exact invoice and is deterministic", () => {
    const a = validateInvoice(invoice(), { rules: rules() })
    expect(a).toEqual([])
    expect(validateInvoice(invoice(), { rules: rules() })).toEqual(a)
  })
  it("rejects one millime of difference unless a tolerance is configured", () => {
    const off = invoice({ totals: { ht: "475.001", vat: "33.250", stamp: "1.000", ttc: "509.251" } })
    expect(codes(off, rules())).toEqual(["HT_MISMATCH"])
    expect(codes(off, rules({ tolerance: "0.001" }))).toEqual([])
  })
  it("checks VAT according to the configured rounding level", () => {
    const tiny: InvoiceInput = invoice({
      lines: [1, 2, 3].map((n) => ({ description: `L${n}`, quantity: 1, unitPrice: "0.010", vatRate: 7, lineHt: "0.010", lineVat: "0.001" })),
      totals: { ht: "0.030", vat: "0.002", stamp: "0", ttc: "0.032" },
    })
    expect(codes(tiny, rules({ vatRounding: "document" }))).toEqual([])
    expect(codes(tiny, rules({ vatRounding: "line" }))).toEqual(["VAT_MISMATCH"])
  })
  it("uses the organization's VAT rates, not a built-in list", () => {
    expect(codes(invoice(), rules({ vatRates: [{ code: "N", rate: "19", label: "19 %" }] }))).toEqual(["UNKNOWN_VAT_RATE"])
  })
  it("checks a configured stamp duty", () => {
    expect(codes(invoice(), rules({ stampDuty: "0.600" }))).toEqual(["STAMP_MISMATCH"])
    expect(codes(invoice(), rules({ stampDuty: "1.000" }))).toEqual([])
  })
  it("includes additional charges in the totals and checks their VAT", () => {
    const withCharge = invoice({
      charges: [{ label: "Transport", amount: "15.000", vatRate: 7, vat: "1.050" }],
      totals: { ht: "490.000", vat: "34.300", stamp: "1.000", ttc: "525.300" },
    })
    expect(codes(withCharge, rules())).toEqual([])
    expect(codes({ ...withCharge, charges: [{ label: "Transport", amount: "15.000", vatRate: 7, vat: "2.000" }] }, rules())).toContain("CHARGE_VAT_MISMATCH")
  })
  it("reports unreadable amounts instead of computing with them", () => {
    const bad = invoice({ lines: [{ description: "x", quantity: "12,5", unitPrice: "9.500", vatRate: 7, lineHt: "118.750", lineVat: "8.313" }] })
    expect(codes(bad, rules())).toContain("INVALID_AMOUNT")
    expect(codes(invoice({ totals: { ht: "abc", vat: "33.250", stamp: "1.000", ttc: "509.250" } }), rules())).toEqual(["HT_MISMATCH", "TOTAL_MISMATCH"])
  })
  it("is float-safe at a 2-decimal currency boundary", () => {
    const r2 = rules({ currency: "EUR", moneyScale: 2 })
    const inv = invoice({ currency: "EUR", lines: [{ description: "x", quantity: 3, unitPrice: "0.335", vatRate: 0, lineHt: "1.01", lineVat: "0.00" }], totals: { ht: "1.01", vat: "0.00", stamp: "0", ttc: "1.01" } })
    expect(codes(inv, rules({ ...r2, vatRates: [{ code: "Z", rate: "0", label: "0" }] }))).toEqual([])
  })
  it("classifies issues: discounts above the threshold warn, out-of-range discounts block", () => {
    const issues = validateInvoice(invoice({ lines: [{ description: "x", quantity: 50, unitPrice: "9.500", discountPct: 85, vatRate: 7, lineHt: "71.250", lineVat: "4.988" }], totals: { ht: "71.250", vat: "4.988", stamp: "1.000", ttc: "77.238" } }), { rules: rules() })
    expect(issues).toEqual([expect.objectContaining({ code: "UNUSUAL_DISCOUNT", severity: "warning" })])
    expect(codes(invoice({ lines: [{ description: "x", quantity: 1, unitPrice: "1", discountPct: 120, vatRate: 7, lineHt: "-0.200", lineVat: "-0.014" }] }), rules())).toContain("INVALID_DISCOUNT")
  })
})

describe("rules configuration", () => {
  it("validates the rules document", () => {
    expect(financialRulesSchema.safeParse(DEMO_FINANCIAL_RULES).success).toBe(true)
    expect(financialRulesSchema.safeParse({ ...DEMO_FINANCIAL_RULES, vatRates: [{ code: "X", rate: "19%", label: "x" }] }).success).toBe(false)
    expect(financialRulesSchema.safeParse({ ...DEMO_FINANCIAL_RULES, moneyScale: 7 }).success).toBe(false)
    expect(financialRulesSchema.safeParse({ ...DEMO_FINANCIAL_RULES, currency: "dinar" }).success).toBe(false)
  })
  it("demo rules are explicitly unverified", () => {
    expect(DEMO_FINANCIAL_RULES.verified).toBe(false)
    expect(DEMO_FINANCIAL_RULES.source).toMatch(/non vérifiées/)
  })
  it("decides when rules may gate an approval", () => {
    expect(rulesUsable(undefined, { isSynthetic: true })).toMatchObject({ ok: false, code: "FINANCIAL_RULES_MISSING" })
    expect(rulesUsable(rules(), { isSynthetic: false })).toMatchObject({ ok: false, code: "FINANCIAL_RULES_UNVERIFIED" })
    expect(rulesUsable(rules(), { isSynthetic: true })).toEqual({ ok: true })
    expect(rulesUsable(rules({ verified: true, verifiedBy: "u", verifiedAt: "2026-10-20T00:00:00Z" }), { isSynthetic: false })).toEqual({ ok: true })
  })
})

describe("approval gate and rules API", () => {
  let issuer: Awaited<ReturnType<typeof startIssuer>>
  beforeAll(async () => {
    issuer = await startIssuer()
  })
  afterAll(() => issuer.close())
  const customer = () => makeApp({ ocr: new StubOcr("complete"), env: { AUTH_MODE: "oidc", OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl } })
  const as = async (role: string, sub = `u-${role}`) => ({ Authorization: `Bearer ${await issuer.sign({ sub, role, agencies: ["*"], org_id: "client-a" })}` })
  const { verified: _v, verifiedBy: _b, verifiedAt: _a, ...editable } = DEMO_FINANCIAL_RULES
  const uploadAndApprove = async (app: ReturnType<typeof makeApp>["app"]) => {
    const up = await request(app).post("/api/v1/documents").set(await as("admin")).field("agency", "Tunis Centre").attach("file", Buffer.concat([PDF, Buffer.from(crypto.randomUUID())]), { filename: "f.pdf", contentType: "application/pdf" })
    expect(up.status).toBe(201)
    return request(app).post(`/api/v1/documents/${up.body.id}/approve`).set(await as("accountant"))
  }

  it("refuses approval when the organization has no rules", async () => {
    const r = await uploadAndApprove(customer().app)
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe("FINANCIAL_RULES_MISSING")
  })
  it("refuses approval with unverified rules for a customer, then accepts once verified", async () => {
    const { app } = customer()
    const put = await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: editable, markVerified: false })
    expect(put.status).toBe(200)
    expect(put.body.rules.verified).toBe(false)
    expect((await uploadAndApprove(app)).body.error.code).toBe("FINANCIAL_RULES_UNVERIFIED")
    const verify = await request(app).put("/api/v1/settings/financial-rules").set(await as("admin", "expert")).send({ rules: { ...editable, source: "Validé par le cabinet X" }, markVerified: true, expectedRevision: 1 })
    expect(verify.status).toBe(200)
    expect(verify.body).toMatchObject({ revision: 2, rules: { verified: true, verifiedBy: "expert" } })
    const ok = await uploadAndApprove(app)
    expect(ok.status).toBe(200)
    expect(ok.body.financialRules).toMatchObject({ revision: 2, verified: true, source: "Validé par le cabinet X" })
  })
  it("any later change clears the verification", async () => {
    const { app } = customer()
    await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: editable, markVerified: true })
    const changed = await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: { ...editable, tolerance: "0.001" }, markVerified: false })
    expect(changed.body.rules).toMatchObject({ verified: false, verifiedBy: null, tolerance: "0.001" })
  })
  it("verification fields cannot be supplied by the client", async () => {
    const { app } = customer()
    const r = await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: { ...editable, verified: true, verifiedBy: "someone" }, markVerified: false })
    expect(r.status).toBe(400)
  })
  it("detects concurrent edits and rejects invalid documents", async () => {
    const { app } = customer()
    await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: editable, markVerified: false })
    const stale = await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: editable, markVerified: false, expectedRevision: 0 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe("REVISION_CONFLICT")
    const dupCodes = await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: { ...editable, vatRates: [{ code: "A", rate: "7", label: "7" }, { code: "A", rate: "19", label: "19" }] }, markVerified: false })
    expect(dupCodes.status).toBe(400)
  })
  it("only settings.manage may change the rules; reviewers may read them", async () => {
    const { app } = customer()
    expect((await request(app).put("/api/v1/settings/financial-rules").set(await as("accountant")).send({ rules: editable, markVerified: true })).status).toBe(403)
    expect((await request(app).get("/api/v1/settings/financial-rules").set(await as("accountant"))).status).toBe(404)
    await request(app).put("/api/v1/settings/financial-rules").set(await as("admin")).send({ rules: editable, markVerified: false })
    expect((await request(app).get("/api/v1/settings/financial-rules").set(await as("manager"))).status).toBe(200)
    expect((await request(app).get("/api/v1/settings/financial-rules").set(await as("commercial"))).status).toBe(403)
  })
  it("development organizations start with the unverified demonstration rules", async () => {
    const { app } = makeApp()
    const r = await request(app).get("/api/v1/settings/financial-rules").set(bearer("dev-admin"))
    expect(r.status).toBe(200)
    expect(r.body.rules).toMatchObject({ currency: "TND", verified: false, source: DEMO_FINANCIAL_RULES.source })
  })
})
