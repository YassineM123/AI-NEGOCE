/**
 * Deterministic SYNTHETIC dataset generator for AI-NEGOCE QA.
 *
 * Every record is fictional. Nothing here is exported from a real ERP.
 * Amounts are computed in integer millimes (1 TND = 1000 millimes) and
 * serialised as fixed 3-decimal strings, so totals reconcile exactly.
 *
 * Usage: npx tsx tools/dataset/generate.ts [outDir]   (env SEED overrides seed)
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const GENERATOR_VERSION = "1.0.0"
const SEED = Number(process.env.SEED ?? 20261015)
const OUT = path.resolve(process.argv[2] ?? "datasets/synthetic/v1")

// Explicit TEST SCENARIO assumptions — not statements about Tunisian tax law.
export const SCENARIO = {
  currency: "TND",
  vatRates: [
    { rate: 19, weight: 0.7 },
    { rate: 13, weight: 0.12 },
    { rate: 7, weight: 0.13 },
    { rate: 0, weight: 0.05 },
  ],
  stampDutyMillimes: 1000, // flat stamp per sales invoice (scenario value)
  periodStart: "2025-01-01",
  periodEnd: "2026-06-30",
  asOf: "2026-06-30",
  costRule:
    "Line cost = quantity x product standard unit cost at generation time (no WAC revaluation).",
}

const TARGET = {
  suppliers: 100,
  customers: 500,
  products: 2000,
  purchaseOrders: 1500,
  supplierInvoices: 3000,
  salesInvoices: 10000,
  creditNotes: 300, // part of the 10,000 sales documents
  payments: 8000,
  stockMovements: 30000,
  representatives: 25,
  transfers: 1200,
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(SEED)
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1))
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
const chance = (p: number) => rnd() < p
function weighted<T extends { weight: number }>(xs: readonly T[]): T {
  let r = rnd() * xs.reduce((s, x) => s + x.weight, 0)
  for (const x of xs) if ((r -= x.weight) <= 0) return x
  return xs[xs.length - 1]
}
const pad = (n: number, w: number) => String(n).padStart(w, "0")
export function money(m: number) {
  const sign = m < 0 ? "-" : ""
  const a = Math.abs(m)
  return `${sign}${Math.floor(a / 1000)}.${pad(a % 1000, 3)}`
}
const DAY = 86_400_000
const toDate = (s: string) => Date.parse(`${s}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const addDays = (s: string, d: number) => iso(toDate(s) + d * DAY)
const spanDays = (toDate(SCENARIO.periodEnd) - toDate(SCENARIO.periodStart)) / DAY
const randomDate = (from = SCENARIO.periodStart, maxDays = spanDays) =>
  addDays(from, int(0, maxDays))
const minDate = (a: string, b: string) => (a < b ? a : b)

// ---------- reference data ----------
const agencies = [
  { id: "AG01", name: "Tunis Centre", city: "Tunis", weight: 0.35, reps: 7 },
  { id: "AG02", name: "Sfax", city: "Sfax", weight: 0.25, reps: 6 },
  { id: "AG03", name: "Sousse", city: "Sousse", weight: 0.18, reps: 5 },
  { id: "AG04", name: "Bizerte", city: "Bizerte", weight: 0.12, reps: 4 },
  { id: "AG05", name: "Nabeul", city: "Nabeul", weight: 0.1, reps: 3 },
]
const firstNames = ["Amel", "Yassine", "Ines", "Karim", "Sana", "Mehdi", "Rim", "Walid", "Nour", "Hichem", "Olfa", "Sami", "Leila", "Anis", "Mouna", "Fares", "Hela", "Bilel", "Asma", "Zied"]
const lastNames = ["Trabelsi", "Khelifi", "Mansour", "Ben Salah", "Gharbi", "Jaziri", "Hammami", "Bouazizi", "Chaabane", "Ferchichi", "Mejri", "Sassi", "Baccouche", "Dridi", "Ayari", "Zouari"]
const syllables = ["ba", "ra", "ti", "no", "me", "sa", "lu", "ka", "di", "ve", "zo", "fa", "ri", "ta", "mo", "el", "an", "or"]
const brand = () => {
  const s = Array.from({ length: int(2, 3) }, () => pick(syllables)).join("")
  return s[0].toUpperCase() + s.slice(1)
}
const categories = [
  { id: "CAT01", name: "Bureaux", cost: [250_000, 1_400_000], markup: [0.18, 0.4], vat: 19 },
  { id: "CAT02", name: "Sièges Bureau", cost: [80_000, 900_000], markup: [0.2, 0.45], vat: 19 },
  { id: "CAT03", name: "Rangement", cost: [120_000, 1_100_000], markup: [0.2, 0.4], vat: 19 },
  { id: "CAT04", name: "Tables", cost: [200_000, 2_200_000], markup: [0.18, 0.38], vat: 19 },
  { id: "CAT05", name: "Papeterie", cost: [800, 25_000], markup: [0.25, 0.6], vat: 7 },
  { id: "CAT06", name: "Informatique", cost: [30_000, 2_800_000], markup: [0.08, 0.22], vat: 19 },
  { id: "CAT07", name: "Consommables impression", cost: [12_000, 260_000], markup: [0.15, 0.35], vat: 19 },
  { id: "CAT08", name: "Hygiène", cost: [1_500, 60_000], markup: [0.2, 0.5], vat: 13 },
  { id: "CAT09", name: "Électricité", cost: [2_000, 180_000], markup: [0.2, 0.45], vat: 19 },
  { id: "CAT10", name: "Quincaillerie", cost: [500, 90_000], markup: [0.25, 0.55], vat: 19 },
  { id: "CAT11", name: "Emballage", cost: [300, 40_000], markup: [0.2, 0.5], vat: 0 },
  { id: "CAT12", name: "Livres et manuels", cost: [5_000, 70_000], markup: [0.15, 0.3], vat: 7 },
]
const nouns: Record<string, string[]> = {
  CAT01: ["Bureau", "Poste de travail", "Bureau direction"],
  CAT02: ["Siège", "Fauteuil", "Chaise visiteur"],
  CAT03: ["Armoire", "Caisson", "Étagère"],
  CAT04: ["Table réunion", "Table modulaire", "Table haute"],
  CAT05: ["Ramette A4", "Classeur", "Stylo", "Cahier"],
  CAT06: ["Écran", "Clavier", "Portable", "Onduleur"],
  CAT07: ["Toner", "Cartouche", "Tambour"],
  CAT08: ["Savon liquide", "Essuie-mains", "Désinfectant"],
  CAT09: ["Câble", "Multiprise", "Lampe LED"],
  CAT10: ["Serrure", "Charnière", "Visserie"],
  CAT11: ["Carton", "Film étirable", "Adhésif"],
  CAT12: ["Manuel", "Guide", "Dictionnaire"],
}
const vatForCategory = (catVat: number) =>
  chance(0.85) ? catVat : weighted(SCENARIO.vatRates).rate

// ---------- master data ----------
const representatives = agencies.flatMap((a, ai) =>
  Array.from({ length: a.reps }, (_, i) => ({
    id: `REP-${pad(ai * 10 + i + 1, 3)}`,
    name: `${pick(firstNames)} ${pick(lastNames)}`,
    agency_id: a.id,
    hire_date: randomDate("2015-01-01", 3000),
  })),
)

const suppliers = Array.from({ length: TARGET.suppliers }, (_, i) => {
  const cats = [categories[i % categories.length].id]
  if (chance(0.35)) cats.push(pick(categories).id)
  return {
    id: `SUP-${pad(i + 1, 3)}`,
    name: `${pick(["STE", "ETS", "SOCIETE", "GROUPE"])} ${brand()} ${pick(["SARL", "SA", "SUARL"])} [FICTIF]`,
    tax_id: `${pad(int(1, 9_999_999), 7)}${String.fromCharCode(65 + int(0, 25))}/A/M/000`,
    city: pick(["Tunis", "Sfax", "Sousse", "Ben Arous", "Ariana", "Monastir", "Nabeul"]),
    payment_terms_days: pick([30, 45, 60, 90]),
    category_ids: Array.from(new Set(cats)).join("|"),
  }
})

const products = Array.from({ length: TARGET.products }, (_, i) => {
  // round-robin guarantees every supplier owns at least one product
  const supplier = i < suppliers.length ? suppliers[i] : pick(suppliers)
  const cat = categories.find((c) => c.id === supplier.category_ids.split("|")[0])!
  const unitCost = int(cat.cost[0], cat.cost[1])
  const markup = cat.markup[0] + rnd() * (cat.markup[1] - cat.markup[0])
  return {
    id: `PRD-${pad(i + 1, 5)}`,
    sku: `${cat.id.slice(3)}-${pad(i + 1, 5)}`,
    name: `${pick(nouns[cat.id])} ${brand()} ${pick(["Pro", "Eco", "Plus", "Max", "S", "XL", "Lite"])}`,
    category_id: cat.id,
    supplier_id: supplier.id,
    unit_cost: unitCost,
    list_price: Math.round(unitCost * (1 + markup)),
    vat_rate: vatForCategory(cat.vat),
    reorder_point: int(2, 40),
    uom: cat.id === "CAT05" || cat.id === "CAT11" ? pick(["unité", "carton", "paquet"]) : "unité",
    popularity: rnd() ** 3, // skew: few best-sellers
  }
})
const productsBySupplier = new Map<string, typeof products>()
for (const p of products)
  productsBySupplier.set(p.supplier_id, [...(productsBySupplier.get(p.supplier_id) ?? []), p])
const popularProducts = [...products].sort((a, b) => b.popularity - a.popularity)
const pickProduct = () => popularProducts[Math.floor(rnd() ** 2.2 * popularProducts.length)]

const customers = Array.from({ length: TARGET.customers }, (_, i) => {
  const agency = weighted(agencies)
  const reps = representatives.filter((r) => r.agency_id === agency.id)
  const segment = pick(["Entreprise", "Administration", "Revendeur", "PME", "PME"])
  return {
    id: `CUS-${pad(i + 1, 4)}`,
    name: `${pick(["STE", "CLINIQUE", "GROUPE", "ETS", "LYCEE", "CABINET"])} ${brand()} ${pick(["SARL", "SA", "", "SUARL"])} [FICTIF]`.replace("  ", " "),
    agency_id: agency.id,
    representative_id: pick(reps).id,
    segment,
    credit_limit: pick([5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000]),
    payment_terms_days: segment === "Administration" ? 90 : pick([0, 30, 30, 60]),
    customer_discount_pct: segment === "Revendeur" ? pick([5, 8, 10]) : pick([0, 0, 0, 2, 5]),
  }
})
const customersByAgency = new Map(agencies.map((a) => [a.id, customers.filter((c) => c.agency_id === a.id)]))

// ---------- purchasing ----------
type Movement = { id: string; date: string; product_id: string; agency_id: string; type: string; quantity: number; reference: string }
const movements: Omit<Movement, "id">[] = []

const purchaseOrders: Record<string, unknown>[] = []
const poLines: Record<string, unknown>[] = []
for (let i = 0; i < TARGET.purchaseOrders; i++) {
  const supplier = pick(suppliers)
  const agency = weighted(agencies)
  const id = `PO-${pad(i + 1, 5)}`
  const date = randomDate(SCENARIO.periodStart, spanDays - 20)
  const owned = productsBySupplier.get(supplier.id)!
  const lines = Array.from({ length: int(1, Math.min(4, owned.length)) }, (_, li) => {
    const p = owned[li % owned.length]
    const qty = int(5, 60)
    return { id: `${id}-L${li + 1}`, purchase_order_id: id, product_id: p.id, quantity: qty, unit_cost: p.unit_cost, line_total: qty * p.unit_cost }
  })
  poLines.push(...lines)
  purchaseOrders.push({
    id, supplier_id: supplier.id, agency_id: agency.id, order_date: date,
    status: chance(0.03) ? "cancelled" : "open", total_ht: lines.reduce((s, l) => s + l.line_total, 0),
  })
}

const supplierInvoices: Record<string, any>[] = []
const supplierInvoiceLines: Record<string, any>[] = []
const supplierSeq = new Map<string, number>()
function addSupplierInvoice(supplierId: string, agencyId: string, date: string, poId: string | null, lines: { product_id: string; quantity: number; unit_cost: number }[]) {
  const id = `SI-${pad(supplierInvoices.length + 1, 5)}`
  const seq = (supplierSeq.get(supplierId) ?? 0) + 1
  supplierSeq.set(supplierId, seq)
  const supplier = suppliers.find((s) => s.id === supplierId)!
  let ht = 0, vat = 0
  lines.forEach((l, li) => {
    const p = products.find((x) => x.id === l.product_id)!
    const lineHt = l.quantity * l.unit_cost
    const lineVat = Math.round((lineHt * p.vat_rate) / 100)
    ht += lineHt
    vat += lineVat
    supplierInvoiceLines.push({ id: `${id}-L${li + 1}`, supplier_invoice_id: id, product_id: l.product_id, quantity: l.quantity, unit_cost: l.unit_cost, vat_rate: p.vat_rate, line_ht: lineHt, line_vat: lineVat })
    movements.push({ date, product_id: l.product_id, agency_id: agencyId, type: "receipt", quantity: l.quantity, reference: id })
  })
  supplierInvoices.push({
    id, supplier_invoice_number: `${supplier.id.replace("SUP-", "F")}-${date.slice(0, 4)}-${pad(seq, 4)}`,
    supplier_id: supplierId, purchase_order_id: poId, agency_id: agencyId, invoice_date: date,
    due_date: addDays(date, supplier.payment_terms_days), currency: SCENARIO.currency,
    total_ht: ht, total_vat: vat, total_ttc: ht + vat, status: "posted",
  })
}
for (const po of purchaseOrders) {
  if (po.status === "cancelled") continue
  if (supplierInvoices.length >= TARGET.supplierInvoices) break
  const lines = poLines.filter((l) => l.purchase_order_id === po.id) as { product_id: string; quantity: number; unit_cost: number }[]
  const invDate = addDays(po.order_date as string, int(3, 20))
  if (lines.length > 1 && chance(0.2)) {
    // partial invoicing: two invoices covering complementary line sets
    const cut = int(1, lines.length - 1)
    addSupplierInvoice(po.supplier_id as string, po.agency_id as string, invDate, po.id as string, lines.slice(0, cut))
    addSupplierInvoice(po.supplier_id as string, po.agency_id as string, addDays(invDate, int(1, 15)), po.id as string, lines.slice(cut))
    po.status = "invoiced"
  } else {
    addSupplierInvoice(po.supplier_id as string, po.agency_id as string, invDate, po.id as string, lines)
    po.status = "invoiced"
  }
}
while (supplierInvoices.length < TARGET.supplierInvoices) {
  const supplier = pick(suppliers)
  const owned = productsBySupplier.get(supplier.id)!
  const lines = Array.from({ length: int(1, Math.min(4, owned.length)) }, (_, li) => {
    const p = owned[li % owned.length]
    return { product_id: p.id, quantity: int(3, 40), unit_cost: p.unit_cost }
  })
  addSupplierInvoice(supplier.id, weighted(agencies).id, randomDate(), null, lines)
}

// ---------- sales ----------
const salesInvoices: Record<string, any>[] = []
const salesLines: Record<string, any>[] = []
const monthSeq = new Map<string, number>()
function docNumber(prefix: string, date: string) {
  const key = `${prefix}${date.slice(2, 4)}${date.slice(5, 7)}`
  const n = (monthSeq.get(key) ?? 0) + 1
  monthSeq.set(key, n)
  return `${prefix}-${date.slice(2, 4)}${date.slice(5, 7)}-${pad(n, 5)}`
}
const invoiceCount = TARGET.salesInvoices - TARGET.creditNotes
const invoiceDates = Array.from({ length: invoiceCount }, () => randomDate()).sort()
for (const date of invoiceDates) {
  const agency = weighted(agencies)
  const customer = pick(customersByAgency.get(agency.id)!)
  const id = `SV-${pad(salesInvoices.length + 1, 5)}`
  const cancelled = chance(0.02)
  const used = new Set<string>()
  let ht = 0, vat = 0, cost = 0, discount = 0
  const nLines = weighted([{ n: 1, weight: 0.45 }, { n: 2, weight: 0.35 }, { n: 3, weight: 0.2 }] as const).n
  for (let li = 0; li < nLines; li++) {
    let p = pickProduct()
    while (used.has(p.id)) p = pickProduct()
    used.add(p.id)
    const qty = p.unit_cost > 500_000 ? int(1, 6) : int(1, 40)
    const discPct = customer.customer_discount_pct + (chance(0.08) ? 5 : 0)
    const gross = qty * p.list_price
    const lineHt = Math.round((gross * (100 - discPct)) / 100)
    const lineVat = Math.round((lineHt * p.vat_rate) / 100)
    const lineCost = qty * p.unit_cost
    ht += lineHt; vat += lineVat; cost += lineCost; discount += gross - lineHt
    salesLines.push({
      id: `${id}-L${li + 1}`, sales_invoice_id: id, product_id: p.id, quantity: qty,
      unit_price: p.list_price, discount_pct: discPct, line_ht: lineHt, vat_rate: p.vat_rate,
      line_vat: lineVat, unit_cost: p.unit_cost, line_cost: lineCost,
    })
    if (!cancelled) movements.push({ date, product_id: p.id, agency_id: agency.id, type: "sale", quantity: -qty, reference: id })
  }
  salesInvoices.push({
    id, number: docNumber("FV", date), doc_type: "invoice", original_invoice_id: null,
    customer_id: customer.id, agency_id: agency.id, representative_id: customer.representative_id,
    invoice_date: date, due_date: addDays(date, customer.payment_terms_days),
    status: cancelled ? "cancelled" : "posted", currency: SCENARIO.currency,
    total_discount: discount, total_ht: ht, total_vat: vat, stamp_duty: SCENARIO.stampDutyMillimes,
    total_ttc: ht + vat + SCENARIO.stampDutyMillimes, total_cost: cost,
  })
}
// credit notes (returns) against posted invoices
const posted = salesInvoices.filter((s) => s.status === "posted" && s.invoice_date <= addDays(SCENARIO.periodEnd, -10))
const credited = new Map<string, number>() // invoice id -> credited TTC
const cnTargets = new Set<string>()
while (cnTargets.size < TARGET.creditNotes) cnTargets.add(pick(posted).id)
for (const origId of [...cnTargets].sort()) {
  const orig = salesInvoices.find((s) => s.id === origId)!
  const lines = salesLines.filter((l) => l.sales_invoice_id === origId)
  const id = `SV-${pad(salesInvoices.length + 1, 5)}`
  const date = minDate(addDays(orig.invoice_date, int(1, 30)), SCENARIO.periodEnd)
  let ht = 0, vat = 0, cost = 0
  lines.filter((_, i) => i === 0 || chance(0.4)).forEach((l, li) => {
    const qty = int(1, l.quantity)
    const lineHt = Math.round((qty * l.unit_price * (100 - l.discount_pct)) / 100)
    const lineVat = Math.round((lineHt * l.vat_rate) / 100)
    ht += lineHt; vat += lineVat; cost += qty * l.unit_cost
    salesLines.push({
      id: `${id}-L${li + 1}`, sales_invoice_id: id, product_id: l.product_id, quantity: qty,
      unit_price: l.unit_price, discount_pct: l.discount_pct, line_ht: lineHt, vat_rate: l.vat_rate,
      line_vat: lineVat, unit_cost: l.unit_cost, line_cost: qty * l.unit_cost,
    })
    movements.push({ date, product_id: l.product_id, agency_id: orig.agency_id, type: "return", quantity: qty, reference: id })
  })
  credited.set(origId, ht + vat)
  salesInvoices.push({
    id, number: docNumber("AV", date), doc_type: "credit_note", original_invoice_id: origId,
    customer_id: orig.customer_id, agency_id: orig.agency_id, representative_id: orig.representative_id,
    invoice_date: date, due_date: date, status: "posted", currency: SCENARIO.currency,
    total_discount: 0, total_ht: ht, total_vat: vat, stamp_duty: 0, total_ttc: ht + vat, total_cost: cost,
  })
}

// ---------- payments & receivables ----------
const payments: Record<string, any>[] = []
const receivables: Record<string, any>[] = []
for (const inv of salesInvoices) {
  if (inv.doc_type !== "invoice" || inv.status !== "posted") continue
  const due = inv.total_ttc - (credited.get(inv.id) ?? 0)
  const old = inv.due_date < addDays(SCENARIO.asOf, -120)
  const r = rnd()
  const state = old ? (r < 0.8 ? "full" : r < 0.88 ? "partial" : "unpaid") : r < 0.5 ? "full" : r < 0.62 ? "partial" : "unpaid"
  const latest = minDate(addDays(inv.due_date, 60), SCENARIO.asOf)
  const payDate = () => {
    const span = Math.max(0, (toDate(latest) - toDate(inv.invoice_date)) / DAY)
    return addDays(inv.invoice_date, int(0, span))
  }
  const amounts: number[] = []
  if (state === "full") {
    if (chance(0.12)) {
      const first = Math.round(due * (0.3 + rnd() * 0.4))
      amounts.push(first, due - first)
    } else amounts.push(due)
  } else if (state === "partial") amounts.push(Math.round(due * (0.2 + rnd() * 0.6)))
  const dates = amounts.map(payDate).sort()
  amounts.forEach((amount, k) =>
    payments.push({
      id: `PAY-${pad(payments.length + 1, 5)}`, sales_invoice_id: inv.id, customer_id: inv.customer_id,
      payment_date: dates[k], amount, method: pick(["virement", "chèque", "espèces", "traite"]),
    }),
  )
  const paid = amounts.reduce((s, a) => s + a, 0)
  const outstanding = due - paid
  receivables.push({
    sales_invoice_id: inv.id, customer_id: inv.customer_id, agency_id: inv.agency_id,
    invoice_date: inv.invoice_date, due_date: inv.due_date, total_ttc: inv.total_ttc,
    credited_ttc: credited.get(inv.id) ?? 0, paid, outstanding,
    days_overdue: outstanding > 0 && inv.due_date < SCENARIO.asOf ? (toDate(SCENARIO.asOf) - toDate(inv.due_date)) / DAY : 0,
    status: outstanding === 0 ? "settled" : paid > 0 ? "partially_paid" : "open",
  })
}

// ---------- transfers, adjustments, inventory ----------
for (let i = 0; i < TARGET.transfers; i++) {
  const p = pickProduct()
  const from = weighted(agencies)
  let to = weighted(agencies)
  while (to.id === from.id) to = weighted(agencies)
  const date = randomDate()
  const qty = int(1, 10)
  const ref = `TR-${pad(i + 1, 5)}`
  movements.push({ date, product_id: p.id, agency_id: from.id, type: "transfer_out", quantity: -qty, reference: ref })
  movements.push({ date, product_id: p.id, agency_id: to.id, type: "transfer_in", quantity: qty, reference: ref })
}
let adj = 0
while (movements.length < TARGET.stockMovements) {
  const p = pickProduct()
  movements.push({ date: randomDate(), product_id: p.id, agency_id: weighted(agencies).id, type: "adjustment", quantity: chance(0.5) ? -int(1, 3) : int(1, 3), reference: `ADJ-${pad(++adj, 5)}` })
}
const typeOrder: Record<string, number> = { receipt: 0, transfer_in: 1, return: 2, adjustment: 3, transfer_out: 4, sale: 5 }
const stockMovements: Movement[] = movements
  .map((m, i) => ({ m, i }))
  .sort((a, b) => a.m.date.localeCompare(b.m.date) || typeOrder[a.m.type] - typeOrder[b.m.type] || a.i - b.i)
  .map(({ m }, i) => ({ id: `MV-${pad(i + 1, 6)}`, ...m }))

const balance = new Map<string, { run: number; min: number; product_id: string; agency_id: string }>()
for (const m of stockMovements) {
  const k = `${m.product_id}|${m.agency_id}`
  const b = balance.get(k) ?? { run: 0, min: 0, product_id: m.product_id, agency_id: m.agency_id }
  b.run += m.quantity
  b.min = Math.min(b.min, b.run)
  balance.set(k, b)
}
const inventory = [...balance.values()]
  .sort((a, b) => a.product_id.localeCompare(b.product_id) || a.agency_id.localeCompare(b.agency_id))
  .map((b) => {
    const p = products.find((x) => x.id === b.product_id)!
    const opening = -b.min + int(0, 15)
    return {
      product_id: b.product_id, agency_id: b.agency_id, opening_date: SCENARIO.periodStart,
      opening_quantity: opening, current_quantity: opening + b.run, unit_cost: p.unit_cost,
      reorder_point: p.reorder_point, as_of: SCENARIO.asOf,
    }
  })

// ---------- write ----------
const MONEY = new Set(["unit_cost", "list_price", "credit_limit", "total_ht", "total_vat", "total_ttc", "total_discount", "stamp_duty", "total_cost", "line_total", "line_ht", "line_vat", "unit_price", "line_cost", "amount", "credited_ttc", "paid", "outstanding"])
const tables: Record<string, Record<string, unknown>[]> = {
  agencies: agencies.map(({ id, name, city }) => ({ id, name, city })),
  representatives,
  product_categories: categories.map(({ id, name, vat }) => ({ id, name, default_vat_rate: vat })),
  suppliers,
  products: products.map(({ popularity: _p, ...p }) => p),
  customers,
  purchase_orders: purchaseOrders,
  purchase_order_lines: poLines,
  supplier_invoices: supplierInvoices,
  supplier_invoice_lines: supplierInvoiceLines,
  sales_invoices: salesInvoices,
  sales_invoice_lines: salesLines,
  payments,
  receivables,
  stock_movements: stockMovements,
  inventory,
  roles: [
    { role: "admin", agencies: "*", permissions: "bi.read|copilot.query|documents.upload|documents.approve" },
    { role: "manager", agencies: "assigned", permissions: "bi.read|copilot.query|documents.upload" },
    { role: "accountant", agencies: "assigned", permissions: "bi.read|copilot.query|documents.upload|documents.approve" },
    { role: "commercial", agencies: "assigned", permissions: "bi.read|copilot.query" },
  ],
}
const serial = (k: string, v: unknown) => (MONEY.has(k) && typeof v === "number" ? money(v) : v)
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return ""
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const sqlVal = (k: string, v: unknown) =>
  v === null || v === undefined ? "NULL" : typeof v === "number" && !MONEY.has(k) ? String(v) : `'${String(serial(k, v)).replace(/'/g, "''")}'`

for (const dir of ["csv", "json", "sql"]) fs.mkdirSync(path.join(OUT, dir), { recursive: true })
const sql: string[] = ["-- AI-NEGOCE SYNTHETIC test fixtures. Fictional data only. PostgreSQL dialect.", "BEGIN;", "CREATE SCHEMA IF NOT EXISTS qa_synthetic;", "SET search_path TO qa_synthetic;"]
for (const [name, rows] of Object.entries(tables)) {
  const cols = Object.keys(rows[0])
  fs.writeFileSync(path.join(OUT, "csv", `${name}.csv`), [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(serial(c, r[c]))).join(","))].join("\n") + "\n")
  fs.writeFileSync(path.join(OUT, "json", `${name}.json`), JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, serial(c, r[c])]))), null, 0) + "\n")
  const type = (c: string) => (MONEY.has(c) ? "numeric(14,3)" : typeof rows[0][c] === "number" ? "integer" : c.endsWith("_date") || c === "as_of" ? "date" : "text")
  sql.push(`DROP TABLE IF EXISTS ${name} CASCADE;`, `CREATE TABLE ${name} (${cols.map((c) => `${c} ${type(c)}`).join(", ")});`)
  for (let i = 0; i < rows.length; i += 500)
    sql.push(`INSERT INTO ${name} (${cols.join(",")}) VALUES\n${rows.slice(i, i + 500).map((r) => `(${cols.map((c) => sqlVal(c, r[c])).join(",")})`).join(",\n")};`)
}
sql.push("COMMIT;")
fs.writeFileSync(path.join(OUT, "sql", "fixtures.sql"), sql.join("\n") + "\n")

const files = ["csv", "json", "sql"].flatMap((d) => fs.readdirSync(path.join(OUT, d)).sort().map((f) => `${d}/${f}`))
const manifest = {
  dataset: "ai-negoce-synthetic",
  classification: "SYNTHETIC — fictional records, no real ERP data",
  generatorVersion: GENERATOR_VERSION,
  seed: SEED,
  scenario: { ...SCENARIO, stampDuty: money(SCENARIO.stampDutyMillimes) },
  counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
  files: Object.fromEntries(files.map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(OUT, f))).digest("hex")])),
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(JSON.stringify(manifest.counts))
