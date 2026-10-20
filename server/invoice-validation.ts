// Supplier-invoice validation rules applied to a reviewed OCR extraction before approval.
// Amounts are compared in integer millimes; rounding is half away from zero.

export type InvoiceLine = {
  productId?: string | null
  description?: string
  quantity: number
  unitPrice: string | number
  discountPct?: number
  vatRate: number
  lineHt: string | number
  lineVat: string | number
}
export type InvoiceInput = {
  supplierId?: string | null
  invoiceNumber?: string | null
  invoiceDate?: string | null
  purchaseOrderId?: string | null
  currency?: string | null
  lines?: InvoiceLine[]
  totals?: { ht?: string | number | null; vat?: string | number | null; stamp?: string | number | null; ttc?: string | number | null }
}
export type ValidationContext = {
  currency: string
  vatRates: number[]
  /** already registered (supplier, number) pairs; omit when unknown */
  registeredInvoices?: { supplierId: string; invoiceNumber: string }[]
  /** purchase orders known to the ERP; omit when unknown */
  knownPurchaseOrders?: string[]
  maxDiscountPct?: number
}
export type ValidationIssue = { code: string; message: string; line?: number }

const millimes = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? NaN : Math.round(Number(v) * 1000))
const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x))
const key = (s: string) => s.trim().toUpperCase()

export function validateInvoice(inv: InvoiceInput, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (code: string, message: string, line?: number) => issues.push({ code, message, ...(line === undefined ? {} : { line }) })
  if (!inv.invoiceNumber?.trim()) add("MISSING_INVOICE_NUMBER", "Numéro de facture absent")
  if (!inv.supplierId?.trim()) add("MISSING_SUPPLIER", "Fournisseur non identifié")
  if (inv.supplierId && inv.invoiceNumber && ctx.registeredInvoices?.some((r) => r.supplierId === inv.supplierId && key(r.invoiceNumber) === key(inv.invoiceNumber!)))
    add("DUPLICATE_INVOICE", "Facture déjà enregistrée pour ce fournisseur")
  if (inv.currency !== ctx.currency) add("CURRENCY_MISMATCH", `Devise ${inv.currency ?? "absente"} différente de ${ctx.currency}`)
  if (inv.purchaseOrderId && ctx.knownPurchaseOrders && !ctx.knownPurchaseOrders.includes(inv.purchaseOrderId))
    add("UNKNOWN_PURCHASE_ORDER", "Bon de commande inconnu")

  const lines = inv.lines ?? []
  let sumHt = 0
  let sumVat = 0
  const seen = new Set<string>()
  lines.forEach((l, i) => {
    const n = i + 1
    const price = millimes(l.unitPrice)
    const ht = millimes(l.lineHt)
    const vat = millimes(l.lineVat)
    const disc = l.discountPct ?? 0
    if (!(l.quantity > 0)) add("NEGATIVE_QUANTITY", "Quantité nulle ou négative", n)
    if (!ctx.vatRates.includes(l.vatRate)) add("UNKNOWN_VAT_RATE", `Taux de TVA ${l.vatRate} % non configuré`, n)
    if (disc > (ctx.maxDiscountPct ?? 30)) add("UNUSUAL_DISCOUNT", `Remise inhabituelle (${disc} %)`, n)
    if (roundHalfAway((l.quantity * price * (100 - disc)) / 100) !== ht) add("LINE_TOTAL_MISMATCH", "Quantité × prix unitaire ≠ total HT de ligne", n)
    if (roundHalfAway((ht * l.vatRate) / 100) !== vat) add("LINE_VAT_MISMATCH", "TVA de ligne incohérente avec son taux", n)
    const sig = JSON.stringify([l.productId ?? l.description, l.quantity, price, disc, l.vatRate])
    if (seen.has(sig)) add("DUPLICATE_LINE", "Ligne en double", n)
    seen.add(sig)
    sumHt += ht
    sumVat += vat
  })
  const t = inv.totals ?? {}
  const ht = millimes(t.ht)
  const vat = millimes(t.vat)
  const stamp = millimes(t.stamp ?? 0)
  const ttc = millimes(t.ttc)
  if (ht !== sumHt) add("HT_MISMATCH", "Total HT ≠ somme des lignes")
  if (vat !== sumVat) add("VAT_MISMATCH", "Total TVA ≠ somme des TVA de lignes")
  if (ttc !== ht + vat + stamp) add("TOTAL_MISMATCH", "TTC ≠ HT + TVA + timbre")
  return issues
}
