import fs from "node:fs"
import path from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgencyScope } from "./auth.js"

export type DashboardPeriod = "month" | "quarter" | "year"
export type Period = DashboardPeriod | "all"

/** Access to the local ERP database built by `npm run db:seed` / `npm run db:reset`. */
export class ErpDatabase {
  private db: DatabaseSync
  /** Incremented on every write so derived caches can be invalidated. */
  version = 0
  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000")
    this.db.exec(`CREATE TABLE IF NOT EXISTS ocr_purchase_imports (
      organization_id TEXT NOT NULL, document_id TEXT NOT NULL,
      supplier_invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id),
      PRIMARY KEY (organization_id, document_id))`)
    // Bases built before app_settings existed
    this.db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  }
  static open(file = process.env.ERP_DB_FILE ?? "var/ai-negoce.db") {
    const resolved = path.resolve(file)
    return fs.existsSync(resolved) ? new ErpDatabase(resolved) : null
  }
  close() {
    this.db.close()
  }

  all<T>(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).all(...params) as T[]
  }
  one<T>(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).get(...params) as T
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params)
  }
  /** Runs fn atomically; any throw rolls every write back. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = fn()
      this.db.exec("COMMIT")
      this.version++
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  agencies() {
    return this.all<{ id: string; name: string; city: string }>("SELECT id, name, city FROM agencies ORDER BY id")
  }

  /** Business "today": frozen for the synthetic dataset, the real date otherwise. */
  asOf() {
    const row = this.one<{ value: string } | undefined>("SELECT value FROM app_settings WHERE key = 'as_of'")
    return row?.value ?? new Date().toISOString().slice(0, 10)
  }

  /** SQL predicate restricting `col` (an agency id column) to the caller's scope. */
  scopeFilter(scope: AgencyScope) {
    const scopeJson = JSON.stringify(scope === "*" ? [] : scope)
    const ids = this.all<{ id: string }>(
      "SELECT id FROM agencies WHERE ? = '[]' OR name IN (SELECT value FROM json_each(?))",
      scopeJson,
      scopeJson,
    ).map((a) => a.id)
    // ids come from the agencies table, never from the request
    const list = JSON.stringify(ids).replace(/'/g, "''")
    return (col: string) => `${col} IN (SELECT value FROM json_each('${list}'))`
  }

  dashboard(period: DashboardPeriod, scope: AgencyScope) {
    const asOf = this.asOf()
    const range = periodRange(asOf, period)
    const prev = { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) }
    const inScope = this.scopeFilter(scope)

    const cur = salesTotals(this, inScope, range.from, range.to)
    const old = salesTotals(this, inScope, prev.from, prev.to)
    const marginPct = (t: typeof cur) => (t.revenue ? ((t.revenue - t.cost) / t.revenue) * 100 : null)

    const receivables = this.one<{ outstanding: number; overdue: number; avgDays: number | null }>(
      `SELECT coalesce(sum(outstanding), 0) outstanding,
              coalesce(sum(CASE WHEN due_date < ? THEN outstanding END), 0) overdue,
              sum(outstanding * (julianday(?) - julianday(invoice_date))) / nullif(sum(outstanding), 0) avgDays
         FROM receivables WHERE outstanding > 0 AND ${inScope("agency_id")}`,
      asOf,
      asOf,
    )
    const stock = stockSummary(this, inScope, asOf)

    // 12 monthly points ending with the as-of month.
    const trendFrom = monthStart(shiftMonth(asOf, -11))
    const months = monthly(this, inScope, trendFrom, asOf)
    const trend = months.map((m) => ({ month: m.month, revenue: m.revenue }))

    const activity = this.all<{
      id: string
      number: string
      date: string
      party: string
      type: string
      amount: number
      status: string
    }>(
      // The latest two documents of each flow, so sales volume does not hide purchases.
      `SELECT * FROM (SELECT * FROM (
         SELECT s.id, s.number, s.invoice_date date, c.name party,
                CASE s.doc_type WHEN 'credit_note' THEN 'Avoir client' ELSE 'Facture vente' END type,
                s.total_ttc amount, s.status
           FROM sales_invoices s JOIN customers c ON c.id = s.customer_id
          WHERE ${inScope("s.agency_id")} ORDER BY s.invoice_date DESC, s.id DESC LIMIT 2)
         UNION ALL SELECT * FROM (
         SELECT f.id, f.supplier_invoice_number, f.invoice_date, p.name, 'Facture achat', f.total_ttc, f.status
           FROM supplier_invoices f JOIN suppliers p ON p.id = f.supplier_id
          WHERE f.invoice_date <= ? AND ${inScope("f.agency_id")} ORDER BY f.invoice_date DESC, f.id DESC LIMIT 2)
         UNION ALL SELECT * FROM (
         SELECT o.id, o.id, o.order_date, p.name, 'Bon commande', o.total_ht, o.status
           FROM purchase_orders o JOIN suppliers p ON p.id = o.supplier_id
          WHERE o.order_date <= ? AND ${inScope("o.agency_id")} ORDER BY o.order_date DESC, o.id DESC LIMIT 2)
       ) ORDER BY date DESC, number DESC`,
      asOf,
      asOf,
    )

    const late = this.one<{ count: number; amount: number }>(
      `SELECT count(*) count, coalesce(sum(outstanding), 0) amount
         FROM receivables WHERE outstanding > 0 AND julianday(?) - julianday(due_date) > 60 AND ${inScope("agency_id")}`,
      asOf,
    )
    const overLimit = this.one<{ count: number; amount: number }>(
      `SELECT count(*) count, coalesce(sum(due - credit_limit), 0) amount FROM (
         SELECT c.credit_limit, sum(r.outstanding) due
           FROM receivables r JOIN customers c ON c.id = r.customer_id
          WHERE r.outstanding > 0 AND ${inScope("r.agency_id")}
          GROUP BY c.id HAVING due > c.credit_limit)`,
    )
    const drops = marginDrops(this, inScope, range, prev)

    return {
      asOf,
      period,
      range,
      previousRange: prev,
      kpis: {
        revenue: round3(cur.revenue),
        revenueChangePct: pctChange(cur.revenue, old.revenue),
        grossMargin: round3(cur.revenue - cur.cost),
        grossMarginPct: round1(marginPct(cur)),
        grossMarginChangePts:
          marginPct(cur) !== null && marginPct(old) !== null ? round1(marginPct(cur)! - marginPct(old)!) : null,
        receivables: round3(receivables.outstanding),
        overdueReceivables: round3(receivables.overdue),
        averageReceivableAgeDays: receivables.avgDays === null ? null : Math.round(receivables.avgDays),
        inventoryValue: round3(stock.value),
        dormantInventoryPct: stock.value ? round1((stock.dormant / stock.value) * 100) : null,
        invoiceCount: cur.invoices,
      },
      trend,
      activity: activity.map((a) => ({ ...a, amount: round3(a.amount) })),
      alerts: {
        lateReceivables: { count: late.count, amount: round3(late.amount) },
        belowReorderPoint: stock.below,
        overCreditLimit: { count: overLimit.count, amount: round3(overLimit.amount) },
        marginDrops: drops.slice(0, 5),
        marginDropCount: drops.length,
      },
      agencies: this.agencies().map((a) => a.name),
      source: "Bac à sable ERP synthétique (SQLite) — données fictives",
    }
  }
}

type InScope = (col: string) => string

/** Revenue HT net of credit notes; cancelled documents excluded. */
export function salesTotals(db: ErpDatabase, inScope: InScope, from: string, to: string) {
  return db.one<{ revenue: number; cost: number; invoices: number }>(
    `SELECT coalesce(sum(CASE doc_type WHEN 'credit_note' THEN -total_ht ELSE total_ht END), 0) revenue,
            coalesce(sum(CASE doc_type WHEN 'credit_note' THEN -total_cost ELSE total_cost END), 0) cost,
            count(*) invoices
       FROM sales_invoices
      WHERE status = 'posted' AND invoice_date BETWEEN ? AND ? AND ${inScope("agency_id")}`,
    from,
    to,
  )
}

/** Monthly revenue and margin, one point per month in [from, to] including empty months. */
export function monthly(db: ErpDatabase, inScope: InScope, from: string, to: string) {
  const rows = db.all<{ month: string; revenue: number; cost: number }>(
    `SELECT substr(invoice_date, 1, 7) month,
            sum(CASE doc_type WHEN 'credit_note' THEN -total_ht ELSE total_ht END) revenue,
            sum(CASE doc_type WHEN 'credit_note' THEN -total_cost ELSE total_cost END) cost
       FROM sales_invoices
      WHERE status = 'posted' AND invoice_date BETWEEN ? AND ? AND ${inScope("agency_id")}
      GROUP BY 1`,
    from,
    to,
  )
  const out: { month: string; revenue: number; margin: number }[] = []
  for (let m = monthStart(from); m <= to; m = shiftMonth(m, 1)) {
    const row = rows.find((r) => r.month === m.slice(0, 7))
    out.push({ month: m.slice(0, 7), revenue: round3(row?.revenue ?? 0), margin: round3((row?.revenue ?? 0) - (row?.cost ?? 0)) })
  }
  return out
}

/** Stock value, items under reorder point and value without any sale in the last 180 days. */
export function stockSummary(db: ErpDatabase, inScope: InScope, asOf: string) {
  return db.one<{ value: number; below: number; dormant: number; items: number; available: number }>(
    `SELECT coalesce(sum(i.current_quantity * i.unit_cost), 0) value,
            coalesce(sum(i.current_quantity < i.reorder_point), 0) below,
            count(*) items,
            coalesce(sum(i.current_quantity > 0), 0) available,
            coalesce(sum(CASE WHEN i.current_quantity > 0 AND NOT EXISTS (
              SELECT 1 FROM stock_movements m
               WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id
                 AND m.type = 'sale' AND m.date > date(?, '-180 days'))
            THEN i.current_quantity * i.unit_cost END), 0) dormant
       FROM inventory i WHERE ${inScope("i.agency_id")}`,
    asOf,
  )
}

/** Margin rate by category x agency, period vs same period last year: drops of `threshold` pts or more, worst first. */
export function marginDrops(
  db: ErpDatabase,
  inScope: InScope,
  range: { from: string; to: string },
  prev: { from: string; to: string },
  threshold = -2,
) {
  const marginBy = (from: string, to: string) =>
    db.all<{ category: string; categoryId: string; agency: string; revenue: number; cost: number }>(
      `SELECT pc.name category, pc.id categoryId, a.name agency,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END) revenue,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END) cost
         FROM sales_invoice_lines l
         JOIN sales_invoices s ON s.id = l.sales_invoice_id
         JOIN products p ON p.id = l.product_id
         JOIN product_categories pc ON pc.id = p.category_id
         JOIN agencies a ON a.id = s.agency_id
        WHERE s.status = 'posted' AND s.invoice_date BETWEEN ? AND ? AND ${inScope("s.agency_id")}
        GROUP BY 1, 2, 3 HAVING revenue > 0`,
      from,
      to,
    )
  const before = new Map(marginBy(prev.from, prev.to).map((r) => [`${r.categoryId}|${r.agency}`, r]))
  return marginBy(range.from, range.to)
    .flatMap((r) => {
      const b = before.get(`${r.categoryId}|${r.agency}`)
      if (!b || r.revenue < 5000) return []
      const pct = (r.revenue - r.cost) / r.revenue
      const prevPct = (b.revenue - b.cost) / b.revenue
      const delta = (pct - prevPct) * 100
      return delta <= threshold
        ? [{
            category: r.category,
            categoryId: r.categoryId,
            agency: r.agency,
            deltaPts: round1(delta),
            marginPct: round1(pct * 100),
            previousMarginPct: round1(prevPct * 100),
          }]
        : []
    })
    .sort((a, b) => a.deltaPts - b.deltaPts)
}

export const round3 = (x: number) => Math.round(x * 1000) / 1000
export function round1(x: number): number
export function round1(x: number | null): number | null
export function round1(x: number | null) {
  return x === null ? null : Math.round(x * 10) / 10
}
export const pctChange = (cur: number, old: number) => (old ? round1(((cur - old) / Math.abs(old)) * 100) : null)

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)
export function shiftMonth(s: string, months: number) {
  const d = parse(monthStart(s))
  d.setUTCMonth(d.getUTCMonth() + months)
  return iso(d)
}
export function shiftDays(s: string, days: number) {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}
function monthStart(s: string) {
  return `${s.slice(0, 7)}-01`
}
export function shiftYear(s: string, years: number) {
  const d = parse(s)
  const target = new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()))
  // 29 Feb -> 28 Feb on non-leap years
  if (target.getUTCMonth() !== d.getUTCMonth()) target.setUTCDate(0)
  return iso(target)
}
/** Period to date, ending at asOf: month, calendar quarter or calendar year. */
export function periodRange(asOf: string, period: DashboardPeriod) {
  const d = parse(asOf)
  const y = d.getUTCFullYear()
  const m = period === "year" ? 0 : period === "quarter" ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth()
  return { from: iso(new Date(Date.UTC(y, m, 1))), to: asOf }
}
