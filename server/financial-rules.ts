// Configurable financial rules (per organization) and exact invoice computation.
// Nothing here is a verified Tunisian tax rule: rates, stamp duty, rounding and thresholds
// come from configuration that the client's accountant must validate (`verified`).
import { z } from "zod"
import { Decimal, sum, type RoundingMode } from "./money.js"

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "Nombre décimal attendu (ex. 19 ou 1.000)")

export const financialRulesSchema = z.object({
  /** ISO 4217 code of the invoices accepted (e.g. TND). */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Decimals of monetary amounts (3 for the Tunisian dinar). */
  moneyScale: z.number().int().min(0).max(6),
  /** Decimals kept for stock quantities after a unit conversion. */
  quantityScale: z.number().int().min(0).max(6),
  roundingMode: z.enum(["half_up", "half_even", "down", "up"]),
  /** "line": VAT rounded on each line then summed; "document": VAT per rate on the summed base. */
  vatRounding: z.enum(["line", "document"]),
  vatRates: z
    .array(z.object({ code: z.string().min(1).max(20), rate: decimalString, label: z.string().min(1).max(80) }))
    .min(1),
  /** Stamp duty expected on every invoice, or null when it is not checked. */
  stampDuty: decimalString.nullable(),
  /** Largest accepted absolute difference between a declared and a computed amount. */
  tolerance: decimalString,
  /** Discount percentage above which a line is flagged (warning); null disables the check. */
  maxDiscountPct: decimalString.nullable(),
  verified: z.boolean(),
  verifiedBy: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  /** Who provided the values (free text, shown with every validation result). */
  source: z.string().min(1).max(300),
})
export type FinancialRules = z.infer<typeof financialRulesSchema>

/**
 * Demonstration values, identical to the figures the prototype used to hardcode. NOT verified:
 * usable only by synthetic organizations; a customer organization must store its own rules,
 * validated by its accountant, before any approval.
 */
export const DEMO_FINANCIAL_RULES: FinancialRules = Object.freeze({
  currency: "TND",
  moneyScale: 3,
  quantityScale: 3,
  roundingMode: "half_up",
  vatRounding: "line",
  vatRates: [
    { code: "TVA0", rate: "0", label: "Exonéré / 0 %" },
    { code: "TVA7", rate: "7", label: "7 %" },
    { code: "TVA13", rate: "13", label: "13 %" },
    { code: "TVA19", rate: "19", label: "19 %" },
  ],
  stampDuty: null,
  tolerance: "0",
  maxDiscountPct: "30",
  verified: false,
  verifiedBy: null,
  verifiedAt: null,
  source: "Valeurs de démonstration reprises du prototype — non vérifiées par un expert-comptable",
}) as FinancialRules

export type LineInput = {
  quantity: string | number
  unitPrice: string | number
  discountPct?: string | number | null
  discountAmount?: string | number | null
  vatRate: string | number
}
export type ChargeInput = { label: string; amount: string | number; vatRate: string | number }

export type ComputedLine = { gross: Decimal; discount: Decimal; ht: Decimal; vat: Decimal }

const r = (d: Decimal, rules: FinancialRules) => d.round(rules.moneyScale, rules.roundingMode as RoundingMode)

/** HT of one line: quantity × unit price − discount, rounded to the money scale. */
export function lineHt(line: LineInput, rules: FinancialRules) {
  const gross = Decimal.parse(line.quantity).mul(Decimal.parse(line.unitPrice))
  const pct = Decimal.tryParse(line.discountPct)
  const amount = Decimal.tryParse(line.discountAmount)
  const discount = (pct ? gross.percent(pct) : Decimal.ZERO).add(amount ?? Decimal.ZERO)
  return { gross, discount, ht: r(gross.sub(discount), rules) }
}

/** VAT on a base at a rate (percent), rounded to the money scale. */
export const vatOn = (base: Decimal, rate: Decimal, rules: FinancialRules) => r(base.percent(rate), rules)

/**
 * Computes an invoice from its lines and additional charges. With vatRounding "line" each
 * line's VAT is rounded; with "document" the VAT is computed once per rate on the summed base.
 */
export function computeInvoice(lines: LineInput[], charges: ChargeInput[], rules: FinancialRules, stamp?: string | number | null) {
  const computed: ComputedLine[] = lines.map((l) => {
    const { gross, discount, ht } = lineHt(l, rules)
    return { gross, discount, ht, vat: vatOn(ht, Decimal.parse(l.vatRate), rules) }
  })
  const chargeLines = charges.map((c) => {
    const ht = r(Decimal.parse(c.amount), rules)
    return { label: c.label, ht, vat: vatOn(ht, Decimal.parse(c.vatRate), rules) }
  })
  const bases = new Map<string, { rate: Decimal; base: Decimal }>()
  const addBase = (rate: Decimal, ht: Decimal) => {
    const key = rate.round(4, "down").toString()
    const prev = bases.get(key)
    bases.set(key, { rate, base: (prev?.base ?? Decimal.ZERO).add(ht) })
  }
  lines.forEach((l, i) => addBase(Decimal.parse(l.vatRate), computed[i].ht))
  charges.forEach((c, i) => addBase(Decimal.parse(c.vatRate), chargeLines[i].ht))
  const vatByRate = [...bases.values()].map((b) => ({ rate: b.rate, base: b.base, vat: vatOn(b.base, b.rate, rules) }))
  const totalHt = sum([...computed.map((c) => c.ht), ...chargeLines.map((c) => c.ht)])
  const totalVat =
    rules.vatRounding === "line"
      ? sum([...computed.map((c) => c.vat), ...chargeLines.map((c) => c.vat)])
      : sum(vatByRate.map((v) => v.vat))
  const stampValue = r(Decimal.tryParse(stamp) ?? (rules.stampDuty ? Decimal.parse(rules.stampDuty) : Decimal.ZERO), rules)
  return { lines: computed, charges: chargeLines, vatByRate, totalHt, totalVat, stamp: stampValue, totalTtc: totalHt.add(totalVat).add(stampValue) }
}

/** Stock quantity = purchase quantity × approved conversion factor, rounded to the quantity scale. */
export function convertQuantity(quantity: string | number, conversionFactor: string | number, rules: FinancialRules) {
  const factor = Decimal.parse(conversionFactor)
  if (factor.sign() <= 0) throw new Error("Facteur de conversion invalide (doit être > 0)")
  return Decimal.parse(quantity).mul(factor).round(rules.quantityScale, rules.roundingMode as RoundingMode)
}

/** Whether rules may be used to approve invoices of an organization. */
export function rulesUsable(rules: FinancialRules | undefined, organization: { isSynthetic: boolean }) {
  if (!rules) return { ok: false as const, code: "FINANCIAL_RULES_MISSING", message: "Règles financières non configurées pour cette organisation" }
  if (!rules.verified && !organization.isSynthetic)
    return { ok: false as const, code: "FINANCIAL_RULES_UNVERIFIED", message: "Règles financières non validées par l’expert-comptable : approbation impossible" }
  return { ok: true as const }
}
