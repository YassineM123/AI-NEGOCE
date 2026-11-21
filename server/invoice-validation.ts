// Supplier-invoice validation applied to a reviewed extraction before approval.
// Exact decimal arithmetic (server/money.ts); rates, rounding, tolerance, stamp duty and the
// discount threshold come from the organization's financial rules (server/financial-rules.ts).
import { DEMO_FINANCIAL_RULES, lineHt, vatOn, type FinancialRules } from "./financial-rules.js"
import { Decimal, sum } from "./money.js"

export type InvoiceLine = {
  productId?: string | null
  description?: string
  quantity: number | string
  unitPrice: string | number
  discountPct?: number | string
  discountAmount?: number | string
  vatRate: number | string
  lineHt: string | number
  lineVat: string | number
}
export type InvoiceCharge = { label: string; amount: string | number; vatRate: number | string; vat?: string | number }
export type InvoiceInput = {
  supplierId?: string | null
  invoiceNumber?: string | null
  invoiceDate?: string | null
  purchaseOrderId?: string | null
  currency?: string | null
  lines?: InvoiceLine[]
  /** Additional charges (transport, packaging…) with their own VAT rate. */
  charges?: InvoiceCharge[]
  totals?: { ht?: string | number | null; vat?: string | number | null; stamp?: string | number | null; ttc?: string | number | null }
}
export type ValidationContext = {
  /** Organization rules; when absent, a context built from `currency` and `vatRates`. */
  rules?: FinancialRules
  currency?: string
  vatRates?: (number | string)[]
  /** already registered (supplier, number) pairs; omit when unknown */
  registeredInvoices?: { supplierId: string; invoiceNumber: string }[]
  /** purchase orders known to the ERP; omit when unknown */
  knownPurchaseOrders?: string[]
  maxDiscountPct?: number
}
export type ValidationIssue = { code: string; message: string; line?: number; severity: "blocking" | "warning" }

const key = (s: string) => s.trim().toUpperCase()

/** Rules for callers that only pass a currency and VAT rates (same arithmetic defaults). */
function contextRules(ctx: ValidationContext): FinancialRules {
  if (ctx.rules) return ctx.rules
  return {
    ...DEMO_FINANCIAL_RULES,
    currency: ctx.currency ?? DEMO_FINANCIAL_RULES.currency,
    vatRates: (ctx.vatRates ?? []).map((rate) => ({ code: `TVA${rate}`, rate: String(rate), label: `${rate} %` })),
    maxDiscountPct: ctx.maxDiscountPct === undefined ? DEMO_FINANCIAL_RULES.maxDiscountPct : String(ctx.maxDiscountPct),
    source: "Contexte de validation fourni par l’appelant",
  }
}

export function validateInvoice(inv: InvoiceInput, ctx: ValidationContext): ValidationIssue[] {
  const rules = contextRules(ctx)
  const tolerance = Decimal.parse(rules.tolerance).abs()
  const close = (a: Decimal, b: Decimal) => a.sub(b).abs().cmp(tolerance) <= 0
  const rates = rules.vatRates.map((v) => Decimal.parse(v.rate))
  const maxDiscount = rules.maxDiscountPct === null ? null : Decimal.parse(rules.maxDiscountPct)
  const issues: ValidationIssue[] = []
  const add = (code: string, message: string, line?: number, severity: ValidationIssue["severity"] = "blocking") =>
    issues.push({ code, message, severity, ...(line === undefined ? {} : { line }) })
  const money = (v: unknown) => Decimal.tryParse(v)

  if (!inv.invoiceNumber?.trim()) add("MISSING_INVOICE_NUMBER", "Numéro de facture absent")
  if (!inv.supplierId?.trim()) add("MISSING_SUPPLIER", "Fournisseur non identifié")
  if (inv.supplierId && inv.invoiceNumber && ctx.registeredInvoices?.some((r) => r.supplierId === inv.supplierId && key(r.invoiceNumber) === key(inv.invoiceNumber!)))
    add("DUPLICATE_INVOICE", "Facture déjà enregistrée pour ce fournisseur")
  if (inv.currency !== rules.currency) add("CURRENCY_MISMATCH", `Devise ${inv.currency ?? "absente"} différente de ${rules.currency}`)
  if (inv.purchaseOrderId && ctx.knownPurchaseOrders && !ctx.knownPurchaseOrders.includes(inv.purchaseOrderId))
    add("UNKNOWN_PURCHASE_ORDER", "Bon de commande inconnu")

  const declaredHt: Decimal[] = []
  const declaredVat: Decimal[] = []
  const seen = new Set<string>()
  ;(inv.lines ?? []).forEach((l, i) => {
    const n = i + 1
    const q = money(l.quantity)
    const price = money(l.unitPrice)
    const rate = money(l.vatRate)
    const ht = money(l.lineHt)
    const vat = money(l.lineVat)
    const pct = l.discountPct === undefined || l.discountPct === null ? Decimal.ZERO : money(l.discountPct)
    if (!q || !price || !rate || !ht || !vat || !pct || (l.discountAmount !== undefined && !money(l.discountAmount))) {
      add("INVALID_AMOUNT", "Montant, quantité ou taux illisible", n)
      return
    }
    if (q.sign() <= 0) add("NEGATIVE_QUANTITY", "Quantité nulle ou négative", n)
    if (!rates.some((x) => x.eq(rate))) add("UNKNOWN_VAT_RATE", `Taux de TVA ${rate.toString()} % non configuré`, n)
    if (pct.sign() < 0 || pct.cmp(Decimal.parse("100")) > 0) add("INVALID_DISCOUNT", "Remise hors de l’intervalle 0–100 %", n)
    else if (maxDiscount && pct.cmp(maxDiscount) > 0) add("UNUSUAL_DISCOUNT", `Remise inhabituelle (${pct.toString()} %)`, n, "warning")
    const expected = lineHt({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, discountAmount: l.discountAmount, vatRate: l.vatRate }, rules).ht
    if (!close(expected, ht)) add("LINE_TOTAL_MISMATCH", "Quantité × prix unitaire ≠ total HT de ligne", n)
    if (!close(vatOn(ht, rate, rules), vat)) add("LINE_VAT_MISMATCH", "TVA de ligne incohérente avec son taux", n)
    const sig = JSON.stringify([l.productId ?? l.description, q.round(6, "down").toString(), price.round(6, "down").toString(), pct.round(4, "down").toString(), rate.round(4, "down").toString()])
    if (seen.has(sig)) add("DUPLICATE_LINE", "Ligne en double", n)
    seen.add(sig)
    declaredHt.push(ht)
    declaredVat.push(vat)
  })
  ;(inv.charges ?? []).forEach((c) => {
    const amount = money(c.amount)
    const rate = money(c.vatRate)
    if (!amount || !rate) return add("INVALID_AMOUNT", `Frais « ${c.label} » illisible`)
    if (!rates.some((x) => x.eq(rate))) add("UNKNOWN_VAT_RATE", `Taux de TVA ${rate.toString()} % non configuré (frais « ${c.label} »)`)
    const vat = vatOn(amount, rate, rules)
    const declared = c.vat === undefined ? undefined : money(c.vat)
    if (declared && !close(vat, declared)) add("CHARGE_VAT_MISMATCH", `TVA incohérente sur les frais « ${c.label} »`)
    declaredHt.push(amount)
    declaredVat.push(declared ?? vat)
  })

  const t = inv.totals ?? {}
  const ht = money(t.ht)
  const vat = money(t.vat)
  const stamp = t.stamp === undefined || t.stamp === null || t.stamp === "" ? Decimal.ZERO : money(t.stamp)
  const ttc = money(t.ttc)
  const sumHt = sum(declaredHt)
  const sumVat =
    rules.vatRounding === "line"
      ? sum(declaredVat)
      : sum(
          [...groupByRate(inv).values()].map((g) => vatOn(g.base, g.rate, rules)),
        )
  if (!ht || !close(ht, sumHt)) add("HT_MISMATCH", "Total HT ≠ somme des lignes")
  if (!vat || !close(vat, sumVat)) add("VAT_MISMATCH", "Total TVA ≠ somme des TVA de lignes")
  if (!stamp) add("INVALID_AMOUNT", "Timbre illisible")
  else if (rules.stampDuty !== null && !close(stamp, Decimal.parse(rules.stampDuty)))
    add("STAMP_MISMATCH", `Timbre ${stamp.toString()} différent du montant configuré ${rules.stampDuty}`)
  if (!ttc || !ht || !vat || !stamp || !close(ttc, ht.add(vat).add(stamp))) add("TOTAL_MISMATCH", "TTC ≠ HT + TVA + timbre")
  return issues
}

/** Declared HT bases per VAT rate (for document-level VAT rounding). */
function groupByRate(inv: InvoiceInput) {
  const groups = new Map<string, { rate: Decimal; base: Decimal }>()
  const add = (rateValue: unknown, amount: unknown) => {
    const rate = Decimal.tryParse(rateValue)
    const base = Decimal.tryParse(amount)
    if (!rate || !base) return
    const k = rate.round(4, "down").toString()
    groups.set(k, { rate, base: (groups.get(k)?.base ?? Decimal.ZERO).add(base) })
  }
  for (const l of inv.lines ?? []) add(l.vatRate, l.lineHt)
  for (const c of inv.charges ?? []) add(c.vatRate, c.amount)
  return groups
}
