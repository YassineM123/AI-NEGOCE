import type { AgencyScope } from "./auth.js"
import {
  ErpDatabase,
  pctChange,
  round1,
  round3,
  salesTotals,
  shiftDays,
  shiftYear,
  stockSummary,
} from "./erp-db.js"

export type PageModule = "sales" | "purchases" | "inventory" | "finance"
export type Tone = "success" | "warning" | "danger" | "info" | "neutral"
export type ColumnType = "text" | "date" | "money" | "signed" | "qty"
export type PageQuery = { tab?: string; days: "30" | "90" | "365" | "all"; q?: string; page: number }

type Stat = {
  label: string
  value: number
  unit: "DT" | "%" | "j" | ""
  delta: string | null
  deltaTone?: "up" | "down"
  note: string
  icon: string
  tone: string
}
type Row = {
  id: string
  cells: (string | number | null)[]
  status: { label: string; tone: Tone }
  action?: { id: "pay" | "receive"; label: string }
}

export const pageTabs: Record<PageModule, { id: string; label: string }[]> = {
  sales: [
    { id: "all", label: "Tous les documents" },
    { id: "invoices", label: "Factures" },
    { id: "credit_notes", label: "Avoirs" },
    { id: "unpaid", label: "Non réglées" },
  ],
  purchases: [
    { id: "all", label: "Tous les documents" },
    { id: "orders", label: "Commandes" },
    { id: "invoices", label: "Factures fournisseurs" },
  ],
  inventory: [
    { id: "stock", label: "État du stock" },
    { id: "movements", label: "Mouvements" },
    { id: "reorder", label: "Réapprovisionnement" },
  ],
  finance: [
    { id: "receipts", label: "Encaissements" },
    { id: "receivables", label: "Échéancier clients" },
    { id: "payables", label: "Échéancier fournisseurs" },
  ],
}

const PAGE_SIZE = 20
const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
const movementLabels: Record<string, string> = {
  sale: "Vente",
  receipt: "Réception",
  adjustment: "Ajustement",
  return: "Retour client",
  transfer_in: "Transfert entrant",
  transfer_out: "Transfert sortant",
}

export function managementPage(db: ErpDatabase, module: PageModule, scope: AgencyScope, query: PageQuery) {
  const asOf = db.asOf()
  const inScope = db.scopeFilter(scope)
  const tab = pageTabs[module].some((t) => t.id === query.tab) ? query.tab! : pageTabs[module][0].id
  const from = query.days === "all" ? "0000-01-01" : shiftDays(asOf, -Number(query.days) + 1)
  const prev = query.days === "all" ? null : { from: shiftYear(from, -1), to: shiftYear(asOf, -1) }
  const search = (query.q ?? "").trim().toLowerCase()
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const offset = (query.page - 1) * PAGE_SIZE

  /** Wraps a base query exposing `search` and `sort_key` columns with search, count and paging. */
  const paged = <T>(sql: string, ...params: (string | number)[]) => {
    const where = `FROM (${sql}) WHERE (? = '' OR lower(search) LIKE ? ESCAPE '\\')`
    const total = db.one<{ n: number }>(`SELECT count(*) n ${where}`, ...params, search, like).n
    const rows = db.all<T>(
      `SELECT * ${where} ORDER BY sort_key DESC LIMIT ? OFFSET ?`,
      ...params,
      search,
      like,
      PAGE_SIZE,
      offset,
    )
    return { total, rows }
  }

  let columns: { label: string; type: ColumnType }[]
  let rows: Row[]
  let total: number
  let stats: Stat[]

  if (module === "sales") {
    type R = { id: string; number: string; party: string; date: string; due: string | null; amount: number; doc_type: string; status: string; outstanding: number | null; paid: number | null }
    const filter =
      tab === "invoices" ? "AND s.doc_type = 'invoice'" : tab === "credit_notes" ? "AND s.doc_type = 'credit_note'" : tab === "unpaid" ? "AND r.outstanding > 0" : ""
    const result = paged<R>(
      `SELECT s.id, s.number, c.name party, s.invoice_date date, s.due_date due, s.total_ttc amount, s.doc_type, s.status,
              r.outstanding, r.paid, s.number || ' ' || c.name search, s.invoice_date || s.id sort_key
         FROM sales_invoices s JOIN customers c ON c.id = s.customer_id
         LEFT JOIN receivables r ON r.sales_invoice_id = s.id
        WHERE ${inScope("s.agency_id")} AND s.invoice_date >= ? ${filter}`,
      from,
    )
    total = result.total
    columns = [
      { label: "Document", type: "text" },
      { label: "Client", type: "text" },
      { label: "Date", type: "date" },
      { label: "Échéance", type: "date" },
      { label: "Montant TTC", type: "money" },
    ]
    rows = result.rows.map((r) => ({
      id: r.id,
      cells: [r.number, r.party, r.date, r.due, r.doc_type === "credit_note" ? -r.amount : r.amount],
      status: salesStatus(r, asOf),
      ...(r.status === "posted" && (r.outstanding ?? 0) > 0 ? { action: { id: "pay" as const, label: "Encaisser" } } : {}),
    }))
    const cur = salesTotals(db, inScope, from, asOf)
    const old = prev && salesTotals(db, inScope, prev.from, prev.to)
    const recv = db.one<{ outstanding: number; overdue: number }>(
      `SELECT coalesce(sum(outstanding), 0) outstanding, coalesce(sum(CASE WHEN due_date < ? THEN outstanding END), 0) overdue
         FROM receivables WHERE outstanding > 0 AND ${inScope("agency_id")}`,
      asOf,
    )
    const collected = db.one<{ billed: number; paid: number }>(
      `SELECT coalesce(sum(total_ttc - credited_ttc), 0) billed, coalesce(sum(paid), 0) paid
         FROM receivables WHERE invoice_date BETWEEN ? AND ? AND ${inScope("agency_id")}`,
      from,
      asOf,
    )
    stats = [
      { label: "CA HT net", value: round3(cur.revenue), unit: "DT", delta: old ? signedPct(pctChange(cur.revenue, old.revenue)) : null, note: prev ? "vs. an dernier" : "toutes dates", icon: "chart", tone: "blue" },
      { label: "Documents émis", value: cur.invoices, unit: "", delta: null, note: "factures et avoirs validés", icon: "file", tone: "amber" },
      { label: "Créances clients", value: round3(recv.outstanding), unit: "DT", delta: recv.overdue ? `${fmt(recv.overdue)} DT échus` : "aucun retard", deltaTone: recv.overdue ? "down" : "up", note: "toutes périodes", icon: "sales", tone: "purple" },
      { label: "Taux d’encaissement", value: collected.billed ? round1((collected.paid / collected.billed) * 100) : 0, unit: "%", delta: null, note: "des factures de la période", icon: "finance", tone: "green" },
    ]
  } else if (module === "purchases") {
    type R = { id: string; number: string; party: string; date: string; due: string | null; amount: number; kind: string; status: string }
    const orders = `SELECT o.id, o.id number, p.name party, o.order_date date, NULL due, o.total_ht amount, 'order' kind, o.status,
                           o.id || ' ' || p.name search, o.order_date || o.id sort_key
                      FROM purchase_orders o JOIN suppliers p ON p.id = o.supplier_id
                     WHERE ${inScope("o.agency_id")} AND o.order_date >= ?`
    const invoices = `SELECT f.id, f.supplier_invoice_number number, p.name party, f.invoice_date date, f.due_date due,
                             f.total_ttc amount, 'invoice' kind, f.status,
                             f.supplier_invoice_number || ' ' || p.name search, f.invoice_date || f.id sort_key
                        FROM supplier_invoices f JOIN suppliers p ON p.id = f.supplier_id
                       WHERE ${inScope("f.agency_id")} AND f.invoice_date >= ?`
    const result =
      tab === "orders"
        ? paged<R>(orders, from)
        : tab === "invoices"
          ? paged<R>(invoices, from)
          : paged<R>(`${orders} UNION ALL ${invoices}`, from, from)
    total = result.total
    columns = [
      { label: "Document", type: "text" },
      { label: "Fournisseur", type: "text" },
      { label: "Date", type: "date" },
      { label: "Échéance", type: "date" },
      { label: "Montant", type: "money" },
    ]
    rows = result.rows.map((r) => ({
      id: r.id,
      cells: [r.number, r.party, r.date, r.due, r.amount],
      status:
        r.kind === "invoice"
          ? { label: "Facture comptabilisée", tone: "success" as Tone }
          : r.status === "ordered"
            ? { label: "Commandée", tone: "info" as Tone }
            : r.status === "invoiced"
              ? { label: "Reçue et facturée", tone: "success" as Tone }
              : { label: "Annulée", tone: "danger" as Tone },
      ...(r.kind === "order" && r.status === "ordered" ? { action: { id: "receive" as const, label: "Réceptionner" } } : {}),
    }))
    const purchases = (a: string, b: string) =>
      db.one<{ v: number }>(
        `SELECT coalesce(sum(total_ht), 0) v FROM supplier_invoices WHERE invoice_date BETWEEN ? AND ? AND ${inScope("agency_id")}`,
        a,
        b,
      ).v
    const cur = purchases(from, asOf)
    const open = db.one<{ v: number; n: number }>(
      `SELECT coalesce(sum(total_ht), 0) v, count(*) n FROM purchase_orders WHERE status = 'ordered' AND ${inScope("agency_id")}`,
    )
    const due = db.one<{ v: number; n: number }>(
      `SELECT coalesce(sum(total_ttc), 0) v, count(*) n FROM supplier_invoices
        WHERE due_date BETWEEN ? AND ? AND ${inScope("agency_id")}`,
      asOf,
      shiftDays(asOf, 30),
    )
    const lead = db.one<{ d: number | null }>(
      `SELECT avg(julianday(f.invoice_date) - julianday(o.order_date)) d
         FROM supplier_invoices f JOIN purchase_orders o ON o.id = f.purchase_order_id
        WHERE f.invoice_date BETWEEN ? AND ? AND ${inScope("f.agency_id")}`,
      from,
      asOf,
    ).d
    stats = [
      { label: "Achats HT", value: round3(cur), unit: "DT", delta: prev ? signedPct(pctChange(cur, purchases(prev.from, prev.to))) : null, note: prev ? "vs. an dernier" : "toutes dates", icon: "cart", tone: "blue" },
      { label: "Commandes ouvertes", value: round3(open.v), unit: "DT", delta: `${open.n} commande${open.n > 1 ? "s" : ""}`, deltaTone: "up", note: "à réceptionner", icon: "file", tone: "amber" },
      { label: "À payer sous 30 j", value: round3(due.v), unit: "DT", delta: `${due.n} facture${due.n > 1 ? "s" : ""}`, deltaTone: "up", note: "échéances fournisseurs", icon: "finance", tone: "purple" },
      { label: "Délai commande → facture", value: lead === null ? 0 : round1(lead), unit: "j", delta: null, note: "moyenne de la période", icon: "stock", tone: "green" },
    ]
  } else if (module === "inventory") {
    if (tab === "movements") {
      type R = { id: string; date: string; product: string; agency: string; type: string; quantity: number; reference: string | null }
      const result = paged<R>(
        `SELECT m.id, m.date, p.sku || ' — ' || p.name product, a.name agency, m.type, m.quantity, m.reference,
                p.sku || ' ' || p.name || ' ' || coalesce(m.reference, '') search, m.date || m.id sort_key
           FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN agencies a ON a.id = m.agency_id
          WHERE ${inScope("m.agency_id")} AND m.date >= ?`,
        from,
      )
      total = result.total
      columns = [
        { label: "Date", type: "date" },
        { label: "Article", type: "text" },
        { label: "Agence", type: "text" },
        { label: "Référence", type: "text" },
        { label: "Quantité", type: "signed" },
      ]
      rows = result.rows.map((r) => ({
        id: r.id,
        cells: [r.date, r.product, r.agency, r.reference, r.quantity],
        status: { label: movementLabels[r.type] ?? r.type, tone: r.quantity >= 0 ? "success" : "info" },
      }))
    } else {
      type R = { id: string; sku: string; name: string; agency: string; quantity: number; reorder_point: number; value: number }
      const result = paged<R>(
        `SELECT i.product_id || '|' || i.agency_id id, p.sku, p.name, a.name agency, i.current_quantity quantity,
                coalesce(i.reorder_point, 0) reorder_point, i.current_quantity * i.unit_cost value,
                p.sku || ' ' || p.name search,
                ${tab === "reorder" ? "printf('%012d', coalesce(i.reorder_point, 0) - i.current_quantity)" : "printf('%020.3f', i.current_quantity * i.unit_cost)"} sort_key
           FROM inventory i JOIN products p ON p.id = i.product_id JOIN agencies a ON a.id = i.agency_id
          WHERE ${inScope("i.agency_id")} ${tab === "reorder" ? "AND i.current_quantity < i.reorder_point" : ""}`,
      )
      total = result.total
      columns = [
        { label: "Référence", type: "text" },
        { label: "Article", type: "text" },
        { label: "Agence", type: "text" },
        { label: "Disponible", type: "qty" },
        { label: "Seuil", type: "qty" },
        { label: "Valeur", type: "money" },
      ]
      rows = result.rows.map((r) => ({
        id: r.id,
        cells: [r.sku, r.name, r.agency, r.quantity, r.reorder_point, round3(r.value)],
        status:
          r.quantity <= 0
            ? { label: "Rupture", tone: "danger" }
            : r.quantity < r.reorder_point
              ? { label: "Stock faible", tone: "warning" }
              : { label: "Disponible", tone: "success" },
      }))
    }
    const s = stockSummary(db, inScope, asOf)
    stats = [
      { label: "Valeur du stock", value: round3(s.value), unit: "DT", delta: null, note: "au coût unitaire", icon: "stock", tone: "blue" },
      { label: "Articles disponibles", value: s.available, unit: "", delta: s.items ? `${round1((s.available / s.items) * 100)} %` : null, deltaTone: "up", note: `sur ${fmt(s.items)} lignes de stock`, icon: "check", tone: "green" },
      { label: "Sous seuil minimum", value: s.below, unit: "", delta: s.below ? "Action requise" : "aucun", deltaTone: s.below ? "down" : "up", note: "à réapprovisionner", icon: "warning", tone: "amber" },
      { label: "Stock dormant", value: round3(s.dormant), unit: "DT", delta: s.value ? `${round1((s.dormant / s.value) * 100)} %` : null, deltaTone: "down", note: "sans vente depuis 180 j", icon: "finance", tone: "red" },
    ]
  } else {
    if (tab === "receivables") {
      type R = { id: string; number: string; party: string; due: string | null; days: number; outstanding: number }
      const result = paged<R>(
        `SELECT r.sales_invoice_id id, s.number, c.name party, r.due_date due,
                CAST(julianday(?) - julianday(r.due_date) AS INTEGER) days, r.outstanding,
                s.number || ' ' || c.name search, printf('%06d', CAST(julianday(?) - julianday(r.due_date) + 50000 AS INTEGER)) || r.sales_invoice_id sort_key
           FROM receivables r JOIN sales_invoices s ON s.id = r.sales_invoice_id JOIN customers c ON c.id = r.customer_id
          WHERE r.outstanding > 0 AND ${inScope("r.agency_id")}`,
        asOf,
        asOf,
      )
      total = result.total
      columns = [
        { label: "Facture", type: "text" },
        { label: "Client", type: "text" },
        { label: "Échéance", type: "date" },
        { label: "Retard (j)", type: "qty" },
        { label: "Reste dû", type: "money" },
      ]
      rows = result.rows.map((r) => ({
        id: r.id,
        cells: [r.number, r.party, r.due, Math.max(r.days, 0), r.outstanding],
        status: r.days > 60 ? { label: "Retard > 60 j", tone: "danger" } : r.days > 0 ? { label: "En retard", tone: "warning" } : { label: "À échoir", tone: "info" },
        action: { id: "pay", label: "Encaisser" },
      }))
    } else if (tab === "payables") {
      type R = { id: string; number: string; party: string; due: string | null; amount: number }
      const result = paged<R>(
        `SELECT f.id, f.supplier_invoice_number number, p.name party, f.due_date due, f.total_ttc amount,
                f.supplier_invoice_number || ' ' || p.name search, f.due_date || f.id sort_key
           FROM supplier_invoices f JOIN suppliers p ON p.id = f.supplier_id
          WHERE ${inScope("f.agency_id")} AND f.due_date >= ?`,
        from,
      )
      total = result.total
      columns = [
        { label: "Facture", type: "text" },
        { label: "Fournisseur", type: "text" },
        { label: "Échéance", type: "date" },
        { label: "Montant TTC", type: "money" },
      ]
      rows = result.rows.map((r) => ({
        id: r.id,
        cells: [r.number, r.party, r.due, -r.amount],
        status: r.due && r.due < asOf ? { label: "Échue", tone: "warning" } : { label: "À échoir", tone: "info" },
      }))
    } else {
      type R = { id: string; party: string; number: string; date: string; method: string | null; amount: number }
      const result = paged<R>(
        `SELECT p.id, c.name party, s.number, p.payment_date date, p.method, p.amount,
                p.id || ' ' || c.name || ' ' || s.number search, p.payment_date || p.id sort_key
           FROM payments p JOIN sales_invoices s ON s.id = p.sales_invoice_id JOIN customers c ON c.id = s.customer_id
          WHERE ${inScope("s.agency_id")} AND p.payment_date >= ?`,
        from,
      )
      total = result.total
      columns = [
        { label: "Règlement", type: "text" },
        { label: "Client", type: "text" },
        { label: "Facture", type: "text" },
        { label: "Date", type: "date" },
        { label: "Mode", type: "text" },
        { label: "Montant", type: "signed" },
      ]
      rows = result.rows.map((r) => ({
        id: r.id,
        cells: [r.id, r.party, r.number, r.date, r.method, r.amount],
        status: { label: "Encaissé", tone: "success" },
      }))
    }
    const received = (a: string, b: string) =>
      db.one<{ v: number }>(
        `SELECT coalesce(sum(p.amount), 0) v FROM payments p JOIN sales_invoices s ON s.id = p.sales_invoice_id
          WHERE p.payment_date BETWEEN ? AND ? AND ${inScope("s.agency_id")}`,
        a,
        b,
      ).v
    const cur = received(from, asOf)
    const recv = db.one<{ outstanding: number; overdue: number; late: number }>(
      `SELECT coalesce(sum(outstanding), 0) outstanding,
              coalesce(sum(CASE WHEN due_date < ? THEN outstanding END), 0) overdue,
              coalesce(sum(due_date < ?), 0) late
         FROM receivables WHERE outstanding > 0 AND ${inScope("agency_id")}`,
      asOf,
      asOf,
    )
    const payable = db.one<{ v: number }>(
      `SELECT coalesce(sum(total_ttc), 0) v FROM supplier_invoices WHERE due_date BETWEEN ? AND ? AND ${inScope("agency_id")}`,
      asOf,
      shiftDays(asOf, 30),
    ).v
    stats = [
      { label: "Encaissé", value: round3(cur), unit: "DT", delta: prev ? signedPct(pctChange(cur, received(prev.from, prev.to))) : null, note: prev ? "vs. an dernier" : "toutes dates", icon: "finance", tone: "blue" },
      { label: "À encaisser", value: round3(recv.outstanding), unit: "DT", delta: null, note: "créances clients ouvertes", icon: "sales", tone: "amber" },
      { label: "Retards clients", value: round3(recv.overdue), unit: "DT", delta: `${recv.late} facture${recv.late > 1 ? "s" : ""}`, deltaTone: recv.late ? "down" : "up", note: "échéance dépassée", icon: "warning", tone: "red" },
      { label: "À décaisser sous 30 j", value: round3(payable), unit: "DT", delta: null, note: "factures fournisseurs", icon: "cart", tone: "purple" },
    ]
  }

  return { module, asOf, tab, tabs: pageTabs[module], columns, rows, total, page: query.page, pageSize: PAGE_SIZE, stats }
}

function salesStatus(r: { doc_type: string; status: string; outstanding: number | null; paid: number | null; due: string | null }, asOf: string): { label: string; tone: Tone } {
  if (r.status === "cancelled") return { label: "Annulée", tone: "danger" }
  if (r.doc_type === "credit_note") return { label: "Avoir", tone: "neutral" }
  if (r.outstanding !== null && r.outstanding <= 0) return { label: "Payée", tone: "success" }
  if (r.due && r.due < asOf) return { label: "En retard", tone: "danger" }
  if ((r.paid ?? 0) > 0) return { label: "Partiellement payée", tone: "warning" }
  return { label: "Validée", tone: "info" }
}

const signedPct = (v: number | null) =>
  v === null ? null : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")} %`
