import type { AgencyScope } from "./auth.js"
import {
  ErpDatabase,
  marginDrops,
  monthly,
  pctChange,
  periodRange,
  round1,
  round3,
  salesTotals,
  shiftMonth,
  shiftYear,
  stockSummary,
  type Period,
} from "./erp-db.js"
import type { Dataset } from "./services.js"
import { datasetMetadata, type InventoryItem, type Receivable, type Sale } from "./data.js"

/** Everything the BI 360 screen shows, computed from the ERP database. */
export function bi360(db: ErpDatabase, scope: AgencyScope, period: Period, focus?: { categoryId: string; agency: string }) {
  const asOf = db.asOf()
  const inScope = db.scopeFilter(scope)
  const first = db.one<{ d: string | null }>("SELECT min(invoice_date) d FROM sales_invoices").d ?? asOf
  const range = period === "all" ? { from: first < asOf ? first : asOf, to: asOf } : periodRange(asOf, period)
  const prev = period === "all" ? null : { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) }

  const cur = salesTotals(db, inScope, range.from, range.to)
  const old = prev ? salesTotals(db, inScope, prev.from, prev.to) : null
  const pct = (t: { revenue: number; cost: number }) => (t.revenue ? ((t.revenue - t.cost) / t.revenue) * 100 : null)
  const receivables = db.one<{ outstanding: number; overdue: number }>(
    `SELECT coalesce(sum(outstanding), 0) outstanding, coalesce(sum(CASE WHEN due_date < ? THEN outstanding END), 0) overdue
       FROM receivables WHERE outstanding > 0 AND ${inScope("agency_id")}`,
    asOf,
  )
  const stock = stockSummary(db, inScope, asOf)

  const agencies = db.all<{ agency: string; revenue: number; cost: number; prevRevenue: number }>(
    `SELECT a.name agency,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -s.total_ht ELSE s.total_ht END END), 0) revenue,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -s.total_cost ELSE s.total_cost END END), 0) cost,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -s.total_ht ELSE s.total_ht END END), 0) prevRevenue
       FROM agencies a LEFT JOIN sales_invoices s ON s.agency_id = a.id AND s.status = 'posted'
      WHERE ${inScope("a.id")}
      GROUP BY a.id ORDER BY revenue DESC, a.id`,
    range.from, range.to, range.from, range.to, prev?.from ?? "", prev?.to ?? "",
  )

  // Stock age = days since the last sale of that product in that agency (never sold = dormant).
  const aging = db.one<{ active: number; watch: number; dormant: number }>(
    `SELECT coalesce(sum(CASE WHEN age < 90 THEN v END), 0) active,
            coalesce(sum(CASE WHEN age BETWEEN 90 AND 180 THEN v END), 0) watch,
            coalesce(sum(CASE WHEN age IS NULL OR age > 180 THEN v END), 0) dormant
       FROM (SELECT i.current_quantity * i.unit_cost v,
                    julianday(?) - julianday((SELECT max(m.date) FROM stock_movements m
                      WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale')) age
               FROM inventory i WHERE i.current_quantity > 0 AND ${inScope("i.agency_id")})`,
    asOf,
  )

  const drops = prev ? marginDrops(db, inScope, range, prev) : []
  const riskyCustomer = db.one<{ customer: string; amount: number; days: number } | undefined>(
    `SELECT c.name customer, sum(r.outstanding) amount, max(CAST(julianday(?) - julianday(r.due_date) AS INTEGER)) days
       FROM receivables r JOIN customers c ON c.id = r.customer_id
      WHERE r.outstanding > 0 AND r.due_date < ? AND ${inScope("r.agency_id")}
      GROUP BY c.id ORDER BY amount DESC LIMIT 1`,
    asOf,
    asOf,
  )
  const overstock = db.one<{ product: string; agency: string; value: number; coverage: number | null } | undefined>(
    `SELECT p.name product, a.name agency, i.current_quantity * i.unit_cost value,
            i.current_quantity / nullif((SELECT -sum(m.quantity) FROM stock_movements m
              WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale'
                AND m.date > date(?, '-90 days')) / 90.0, 0) coverage
       FROM inventory i JOIN products p ON p.id = i.product_id JOIN agencies a ON a.id = i.agency_id
      WHERE i.current_quantity > 0 AND ${inScope("i.agency_id")}
      ORDER BY coalesce(coverage, 1e9) * value DESC LIMIT 1`,
    asOf,
  )
  const anomalies = [
    ...(drops[0]
      ? [{ severity: "high", kind: "margin", title: "Baisse de marge inhabituelle", subject: `${drops[0].category} · Agence ${drops[0].agency}`, detail: `${drops[0].deltaPts} pts vs même période N-1` }]
      : []),
    ...(riskyCustomer
      ? [{ severity: "medium", kind: "receivable", title: "Créances à risque", subject: `Client ${riskyCustomer.customer}`, detail: `${round3(riskyCustomer.amount)} DT · ${riskyCustomer.days} jours de retard` }]
      : []),
    ...(overstock && overstock.value > 0
      ? [{ severity: "low", kind: "stock", title: overstock.coverage === null ? "Stock sans vente (90 j)" : "Surstock détecté", subject: `${overstock.product} · ${overstock.agency}`, detail: overstock.coverage === null ? `${round3(overstock.value)} DT immobilisés` : `Couverture estimée : ${Math.round(overstock.coverage)} jours` }]
      : []),
  ]

  // Without a selection or a real alert, analyse the category whose margin moved the worst.
  const worst = drops[0] ?? (prev ? marginDrops(db, inScope, range, prev, Infinity)[0] : undefined)
  const target = focus ?? (worst ? { categoryId: worst.categoryId, agency: worst.agency } : null)
  return {
    asOf,
    period,
    range,
    previousRange: prev,
    agencyNames: db.all<{ name: string }>(`SELECT name FROM agencies WHERE ${inScope("id")} ORDER BY id`).map((a) => a.name),
    kpis: {
      revenue: round3(cur.revenue),
      revenueChangePct: old ? pctChange(cur.revenue, old.revenue) : null,
      grossMargin: round3(cur.revenue - cur.cost),
      grossMarginPct: round1(pct(cur)),
      grossMarginChangePts: old && pct(cur) !== null && pct(old) !== null ? round1(pct(cur)! - pct(old)!) : null,
      receivables: round3(receivables.outstanding),
      overdueReceivables: round3(receivables.overdue),
      inventoryValue: round3(stock.value),
      dormantInventory: round3(aging.dormant),
      invoiceCount: cur.invoices,
    },
    monthly: monthly(db, inScope, shiftMonth(asOf, -11), asOf),
    agencies: agencies.map((a) => ({
      agency: a.agency,
      revenue: round3(a.revenue),
      changePct: prev ? pctChange(a.revenue, a.prevRevenue) : null,
      margin: round3(a.revenue - a.cost),
      marginPct: round1(pct(a)),
      sharePct: cur.revenue ? round1((a.revenue / cur.revenue) * 100) : 0,
    })),
    stockAging: { active: round3(aging.active), watch: round3(aging.watch), dormant: round3(aging.dormant) },
    anomalies,
    marginDrops: drops,
    marginFocus: target && prev ? marginFocus(db, inScope, range, prev, target) : null,
  }
}

/** Margin bridge for one category in one agency: price, cost, discount and mix effects. */
function marginFocus(
  db: ErpDatabase,
  inScope: (col: string) => string,
  range: { from: string; to: string },
  prev: { from: string; to: string },
  target: { categoryId: string; agency: string },
) {
  type P = { productId: string; sku: string; name: string; qty: number; revenue: number; cost: number; gross: number }
  const byProduct = (from: string, to: string) =>
    db.all<P>(
      `SELECT p.id productId, p.sku, p.name,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.quantity ELSE l.quantity END) qty,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END) revenue,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END) cost,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -1 ELSE 1 END * l.quantity * l.unit_price) gross
         FROM sales_invoice_lines l
         JOIN sales_invoices s ON s.id = l.sales_invoice_id
         JOIN products p ON p.id = l.product_id
         JOIN agencies a ON a.id = s.agency_id
        WHERE s.status = 'posted' AND s.invoice_date BETWEEN ? AND ? AND ${inScope("s.agency_id")}
          AND p.category_id = ? AND a.name = ?
        GROUP BY p.id`,
      from, to, target.categoryId, target.agency,
    )
  const now = byProduct(range.from, range.to)
  const before = new Map(byProduct(prev.from, prev.to).map((p) => [p.productId, p]))
  const sum = (rows: P[], k: keyof P) => rows.reduce((s, r) => s + (r[k] as number), 0)
  const revenue = sum(now, "revenue")
  const margin = revenue - sum(now, "cost")
  const prevRows = [...before.values()]
  const prevRevenue = sum(prevRows, "revenue")
  const prevPct = prevRevenue ? (prevRevenue - sum(prevRows, "cost")) / prevRevenue : 0
  const expected = revenue * prevPct
  let priceEffect = 0, costEffect = 0, discountEffect = 0
  for (const p of now) {
    const b = before.get(p.productId)
    if (!b || !b.qty || !p.qty) continue
    priceEffect += p.qty * (p.gross / p.qty - b.gross / b.qty)
    costEffect -= p.qty * (p.cost / p.qty - b.cost / b.qty)
    discountEffect -= p.qty * ((p.gross - p.revenue) / p.qty - (b.gross - b.revenue) / b.qty)
  }
  const gap = margin - expected
  const factors = [
    { label: "Évolution du coût d’achat", value: round3(costEffect) },
    { label: "Remises commerciales", value: round3(discountEffect) },
    { label: "Évolution des prix de vente", value: round3(priceEffect) },
    { label: "Mix produits et volumes", value: round3(gap - costEffect - discountEffect - priceEffect) },
  ].sort((a, b) => a.value - b.value)
  const category = db.one<{ name: string }>("SELECT name FROM product_categories WHERE id = ?", target.categoryId).name
  const invoices = db.all<{ number: string; date: string; customer: string; revenue: number; cost: number }>(
    `SELECT s.number, s.invoice_date date, c.name customer,
            sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END) revenue,
            sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END) cost
       FROM sales_invoice_lines l
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
       JOIN customers c ON c.id = s.customer_id
       JOIN products p ON p.id = l.product_id
       JOIN agencies a ON a.id = s.agency_id
      WHERE s.status = 'posted' AND s.invoice_date BETWEEN ? AND ? AND ${inScope("s.agency_id")}
        AND p.category_id = ? AND a.name = ?
      GROUP BY s.id ORDER BY (sum(l.line_ht) - sum(l.line_cost)) / nullif(sum(l.line_ht), 0) ASC LIMIT 50`,
    range.from, range.to, target.categoryId, target.agency,
  )
  return {
    category,
    categoryId: target.categoryId,
    agency: target.agency,
    revenue: round3(revenue),
    margin: round3(margin),
    marginPct: revenue ? round1((margin / revenue) * 100) : null,
    previousMarginPct: round1(prevPct * 100),
    expectedMargin: round3(expected),
    gap: round3(gap),
    factors,
    products: now
      .map((p) => {
        const pPct = p.revenue ? (p.revenue - p.cost) / p.revenue : 0
        return {
          sku: p.sku,
          name: p.name,
          qty: p.qty,
          revenue: round3(p.revenue),
          averageCost: p.qty ? round3(p.cost / p.qty) : 0,
          marginPct: round1(pPct * 100),
          gap: round3(p.revenue - p.cost - p.revenue * prevPct),
        }
      })
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 10),
    invoiceCount: db.one<{ n: number }>(
      `SELECT count(DISTINCT s.id) n FROM sales_invoice_lines l JOIN sales_invoices s ON s.id = l.sales_invoice_id
         JOIN products p ON p.id = l.product_id JOIN agencies a ON a.id = s.agency_id
        WHERE s.status = 'posted' AND s.invoice_date BETWEEN ? AND ? AND ${inScope("s.agency_id")} AND p.category_id = ? AND a.name = ?`,
      range.from, range.to, target.categoryId, target.agency,
    ).n,
    invoices: invoices.map((i) => ({
      ...i,
      revenue: round3(i.revenue),
      cost: round3(i.cost),
      margin: round3(i.revenue - i.cost),
      marginPct: i.revenue ? round1(((i.revenue - i.cost) / i.revenue) * 100) : null,
    })),
  }
}

let cached: { db: ErpDatabase; version: number; data: Dataset } | null = null
/** The BI/Copilot fact model (one row per invoice line) loaded from the database, cached until the next write. */
export function datasetFrom(db: ErpDatabase): Dataset {
  if (cached && cached.db === db && cached.version === db.version) return cached.data
  const sales = db.all<Sale & { kind: "invoice" | "credit_note" }>(
    `SELECT l.id, s.number invoiceId, s.invoice_date date, a.name agency, c.name customer, c.id customerId,
            p.id productId, p.name product, pc.name family, coalesce(r.name, '—') representative,
            CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END revenue,
            CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END cost,
            s.doc_type kind, s.status
       FROM sales_invoice_lines l
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
       JOIN agencies a ON a.id = s.agency_id
       JOIN customers c ON c.id = s.customer_id
       JOIN products p ON p.id = l.product_id
       JOIN product_categories pc ON pc.id = p.category_id
       LEFT JOIN representatives r ON r.id = s.representative_id`,
  )
  const receivables = db.all<Receivable>(
    `SELECT s.number invoiceId, a.name agency, c.name customer, r.invoice_date date, r.due_date dueDate, r.outstanding
       FROM receivables r JOIN sales_invoices s ON s.id = r.sales_invoice_id
       JOIN agencies a ON a.id = r.agency_id JOIN customers c ON c.id = r.customer_id
      WHERE r.outstanding > 0`,
  )
  const inventory = db.all<InventoryItem>(
    `SELECT p.sku reference, p.name product, a.name agency, i.current_quantity quantity,
            coalesce(i.reorder_point, 0) reorderPoint, i.unit_cost unitCost
       FROM inventory i JOIN products p ON p.id = i.product_id JOIN agencies a ON a.id = i.agency_id`,
  )
  const data: Dataset = {
    sales,
    receivables,
    inventory,
    metadata: { ...datasetMetadata, source: "Bac à sable ERP synthétique (SQLite) — données fictives", asOf: db.asOf(), lastUpdated: new Date().toISOString() },
  }
  cached = { db, version: db.version, data }
  return data
}
