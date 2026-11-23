/**
 * Detailed BI modules (articles, stock, receivables, margin, collections) built from
 * the SAME authorized Dataset, agency scope and period as /analytics/overview.
 * Read-only and descriptive: an absent source is reported as "not_available",
 * never as zero, and no figure is inferred from another source.
 */
import { filteredSales, type Dataset, type Filters } from "./services.js"

const toM = (n: number) => Math.round(n * 1000)
const fromM = (m: number) => m / 1000
const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null
const inScope = (agency: string, f: Filters) => !f.agencies || f.agencies === "*" || f.agencies.includes(agency)
const inPeriod = (date: string, f: Filters) => (!f.from || date >= f.from) && (!f.to || date <= f.to)
const days = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000)

type Unavailable = { status: "not_available"; reason: string }
const unavailable = (reason: string): Unavailable => ({ status: "not_available", reason })

export function buildBiModules(dataset: Dataset, filters: Filters = {}) {
  const asOf = dataset.metadata.asOf ?? new Date().toISOString().slice(0, 10)
  if (dataset.metadata.source.includes("Database/extractions")) {
    const reason = "Extrait pseudonymisé : lignes articles, stock valorisé, échéances et encaissements non reliés."
    return { articles: unavailable(reason), margin: unavailable(reason), stock: unavailable(reason),
      receivables: unavailable(reason), cash: unavailable(reason) }
  }
  const sales = filteredSales(filters, dataset)

  // ---- Articles: grouped by stable product id when present.
  const byProduct = new Map<string, { id: string; label: string; family: string; revenue: number; cost: number
    costMissing: number; quantity: number; quantityMissing: number; documents: Set<string> }>()
  for (const s of sales) {
    const id = s.productId ?? s.product
    const p = byProduct.get(id) ?? { id, label: s.product, family: s.family, revenue: 0, cost: 0,
      costMissing: 0, quantity: 0, quantityMissing: 0, documents: new Set<string>() }
    p.revenue += toM(s.revenue)
    if (s.cost === null || s.cost === undefined) p.costMissing++
    else p.cost += toM(s.cost)
    if (typeof s.quantity === "number" && Number.isFinite(s.quantity)) p.quantity += s.quantity
    else p.quantityMissing++
    p.documents.add(s.invoiceId)
    byProduct.set(id, p)
  }
  const totalRevenue = sales.reduce((n, s) => n + toM(s.revenue), 0)
  const products = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue || a.id.localeCompare(b.id))
  const articles = sales.length ? {
    status: "observed" as const,
    productCount: products.length,
    topProducts: products.slice(0, 15).map((p) => ({
      id: p.id, label: p.label, family: p.family, revenue: fromM(p.revenue),
      sharePercent: pct(p.revenue, totalRevenue),
      // A partial quantity or cost is never shown as if it were complete.
      quantity: p.quantityMissing ? null : Math.round(p.quantity * 1000) / 1000,
      marginPercent: p.costMissing ? null : pct(p.revenue - p.cost, p.revenue),
      documents: p.documents.size,
    })),
  } : unavailable("Aucune vente sur ce périmètre.")

  // ---- Margin: only fully costed rows enter the margin; missing costs are counted.
  const famMap = new Map<string, { family: string; revenue: number; costedRevenue: number; cost: number; missing: number }>()
  const monthMap = new Map<string, { month: string; revenue: number; costedRevenue: number; cost: number }>()
  for (const s of sales) {
    const f = famMap.get(s.family) ?? { family: s.family, revenue: 0, costedRevenue: 0, cost: 0, missing: 0 }
    const m = monthMap.get(s.date.slice(0, 7)) ?? { month: s.date.slice(0, 7), revenue: 0, costedRevenue: 0, cost: 0 }
    f.revenue += toM(s.revenue); m.revenue += toM(s.revenue)
    if (s.cost === null || s.cost === undefined) f.missing++
    else { f.costedRevenue += toM(s.revenue); f.cost += toM(s.cost); m.costedRevenue += toM(s.revenue); m.cost += toM(s.cost) }
    famMap.set(s.family, f); monthMap.set(m.month, m)
  }
  const costedRows = sales.filter((s) => s.cost !== null && s.cost !== undefined)
  const margin = costedRows.length ? {
    status: "observed" as const,
    missingCostRows: sales.length - costedRows.length,
    byFamily: [...famMap.values()].sort((a, b) => b.revenue - a.revenue || a.family.localeCompare(b.family)).map((f) => ({
      family: f.family, revenue: fromM(f.revenue), margin: fromM(f.costedRevenue - f.cost),
      marginPercent: pct(f.costedRevenue - f.cost, f.costedRevenue), missingCostRows: f.missing,
    })),
    months: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-36).map((m) => ({
      month: m.month, revenue: fromM(m.revenue), margin: fromM(m.costedRevenue - m.cost),
      marginPercent: pct(m.costedRevenue - m.cost, m.costedRevenue),
    })),
  } : unavailable("Aucun coût historique connu sur ce périmètre.")

  // ---- Stock: a current snapshot, meaningful only when the period includes the as-of date.
  const stockApplicable = (!filters.from || filters.from <= asOf) && (!filters.to || filters.to >= asOf)
  const positions = dataset.inventory.filter((i) => inScope(i.agency, filters))
  const stockRows = positions.map((i) => ({
    reference: i.reference, product: i.product, agency: i.agency, quantity: i.quantity,
    reorderPoint: i.reorderPoint, unitCost: i.unitCost, value: fromM(i.quantity * toM(i.unitCost)),
    belowReorder: Number.isFinite(i.reorderPoint) && i.reorderPoint > 0 && i.quantity < i.reorderPoint,
  }))
  const stock = !stockApplicable
    ? unavailable("Le stock est une photo au " + asOf + " : choisissez une période qui inclut cette date.")
    : positions.length ? {
      status: "observed_current_snapshot" as const, asOf,
      positions: stockRows.length,
      totalValue: fromM(stockRows.reduce((n, r) => n + toM(r.value), 0)),
      belowReorder: stockRows.filter((r) => r.belowReorder).length,
      topByValue: [...stockRows].sort((a, b) => b.value - a.value || a.reference.localeCompare(b.reference)).slice(0, 15),
      toReorder: stockRows.filter((r) => r.belowReorder)
        .sort((a, b) => (a.quantity - a.reorderPoint) - (b.quantity - b.reorderPoint) || a.reference.localeCompare(b.reference))
        .slice(0, 15),
    } : unavailable("Aucune position de stock sur ce périmètre.")

  // ---- Receivables: same selection as the BI overview KPI (invoice date in period), aged at as-of.
  const debts = dataset.receivables.filter((r) => inScope(r.agency, filters) && inPeriod(r.date, filters))
  const buckets = [
    { key: "not_due", label: "Non échues", amount: 0, documents: 0 },
    { key: "late_1_30", label: "1–30 jours", amount: 0, documents: 0 },
    { key: "late_31_60", label: "31–60 jours", amount: 0, documents: 0 },
    { key: "late_61_90", label: "61–90 jours", amount: 0, documents: 0 },
    { key: "late_91_plus", label: "Plus de 90 jours", amount: 0, documents: 0 },
  ]
  const debtors = new Map<string, { id: string; name: string; outstanding: number; overdue: number; documents: number; oldestDue: string }>()
  for (const r of debts) {
    const late = days(r.dueDate, asOf)
    const b = buckets[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4]
    b.amount += toM(r.outstanding); b.documents++
    const key = r.customerId ?? r.customer
    const d = debtors.get(key) ?? { id: key, name: r.customer, outstanding: 0, overdue: 0, documents: 0, oldestDue: r.dueDate }
    d.outstanding += toM(r.outstanding); d.documents++
    if (r.dueDate < asOf) d.overdue += toM(r.outstanding)
    if (r.dueDate < d.oldestDue) d.oldestDue = r.dueDate
    debtors.set(key, d)
  }
  const receivables = debts.length ? {
    status: "observed" as const, asOf,
    outstanding: fromM(buckets.reduce((n, b) => n + b.amount, 0)),
    overdue: fromM(buckets.slice(1).reduce((n, b) => n + b.amount, 0)),
    documents: debts.length,
    buckets: buckets.map((b) => ({ key: b.key, label: b.label, amount: fromM(b.amount), documents: b.documents })),
    topDebtors: [...debtors.values()].sort((a, b) => b.outstanding - a.outstanding || a.id.localeCompare(b.id)).slice(0, 15)
      .map((d) => ({ id: d.id, name: d.name, outstanding: fromM(d.outstanding), overdue: fromM(d.overdue),
        documents: d.documents, daysOverdue: Math.max(0, days(d.oldestDue, asOf)) })),
  } : unavailable("Aucune créance pour les factures émises sur ce périmètre.")

  // ---- Cash collections: posted customer payments, not bank settlement.
  const end = filters.to && filters.to < asOf ? filters.to : asOf
  const paid = (dataset.collections ?? []).filter((c) =>
    inScope(c.agency, filters) && (!filters.from || c.date >= filters.from) && c.date <= end)
  const cashMonths = new Map<string, { month: string; amount: number; count: number }>()
  for (const c of paid) {
    const m = cashMonths.get(c.date.slice(0, 7)) ?? { month: c.date.slice(0, 7), amount: 0, count: 0 }
    m.amount += toM(c.amountTnd); m.count++
    cashMonths.set(m.month, m)
  }
  const cashTotal = paid.reduce((n, c) => n + toM(c.amountTnd), 0)
  const cash = !dataset.collections
    ? unavailable("Historique des encaissements clients non fourni par la source.")
    : paid.length ? {
      status: "observed" as const,
      total: fromM(cashTotal), count: paid.length,
      months: [...cashMonths.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-36)
        .map((m) => ({ month: m.month, amount: fromM(m.amount), count: m.count })),
    } : unavailable("Aucun encaissement enregistré sur ce périmètre.")

  return { articles, margin, stock, receivables, cash }
}
