import type { AgencyScope } from "../auth.js"
import { ErpDatabase } from "../erp-db.js"
import {
  calcPctChange,
  round1,
  round3,
  safeDiv,
  safePct,
  resolvePeriodDates,
  buildFilterClauses,
} from "./semantic.js"
import type { BiUniversalFilters, PurchasesResponse } from "./types.js"

export function computePurchases(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): PurchasesResponse {
  const { asOf, range, previousRange } = resolvePeriodDates(db, filters.period, filters.from, filters.to)
  const currentFilters: BiUniversalFilters = { ...filters, from: range.from, to: range.to }
  const prevFilters: BiUniversalFilters = previousRange ? { ...filters, from: previousRange.from, to: previousRange.to } : {}

  const inScope = db.scopeFilter(scope)

  // 1. Current Purchases Totals
  const curClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "f.agency_id",
    dateCol: "f.invoice_date",
    supplierCol: "f.supplier_id",
  })

  const curTotals = db.one<{
    totalHt: number
    invoicesCount: number
    activeSuppliersCount: number
  }>(
    `SELECT coalesce(sum(f.total_ht), 0) totalHt,
            count(DISTINCT f.id) invoicesCount,
            count(DISTINCT f.supplier_id) activeSuppliersCount
       FROM supplier_invoices f
      WHERE f.status != 'cancelled' AND ${curClause.whereClause}`,
    ...curClause.params,
  )

  let prevTotalHt: number | null = null
  if (previousRange) {
    const prevClause = buildFilterClauses(db, scope, prevFilters, {
      agencyCol: "f.agency_id",
      dateCol: "f.invoice_date",
      supplierCol: "f.supplier_id",
    })
    prevTotalHt = db.one<{ totalHt: number }>(
      `SELECT coalesce(sum(f.total_ht), 0) totalHt
         FROM supplier_invoices f
        WHERE f.status != 'cancelled' AND ${prevClause.whereClause}`,
      ...prevClause.params,
    ).totalHt
  }

  const totalPurchasesHt = round3(curTotals.totalHt)

  // 2. Open Purchase Orders
  const poClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "po.agency_id",
    supplierCol: "po.supplier_id",
  })
  const poStats = db.one<{ count: number; totalHt: number }>(
    `SELECT count(*) count, coalesce(sum(po.total_ht), 0) totalHt
       FROM purchase_orders po
      WHERE po.status IN ('draft', 'pending', 'approved', 'open') AND ${poClause.whereClause}`,
    ...poClause.params,
  )

  // 3. Monthly Purchases Trend
  const monthlyPurchases = db.all<{
    month: string
    purchasesHt: number
    ordersCount: number
  }>(
    `SELECT substr(f.invoice_date, 1, 7) month,
            coalesce(sum(f.total_ht), 0) purchasesHt,
            count(DISTINCT f.id) ordersCount
       FROM supplier_invoices f
      WHERE f.status != 'cancelled' AND ${curClause.whereClause}
      GROUP BY month ORDER BY month ASC`,
    ...curClause.params,
  ).map((m) => ({
    month: m.month,
    purchasesHt: round3(m.purchasesHt),
    ordersCount: m.ordersCount,
  }))

  // 4. Top Suppliers & Concentration Pareto
  const supplierRows = db.all<{
    id: string
    name: string
    city: string
    totalPurchasesHt: number
    invoicesCount: number
    paymentTermsDays: number | null
  }>(
    `SELECT s.id, s.name, coalesce(s.city, 'Tunis') city,
            coalesce(sum(f.total_ht), 0) totalPurchasesHt,
            count(DISTINCT f.id) invoicesCount,
            s.payment_terms_days paymentTermsDays
       FROM suppliers s
       JOIN supplier_invoices f ON f.supplier_id = s.id
      WHERE f.status != 'cancelled' AND ${curClause.whereClause}
      GROUP BY s.id ORDER BY totalPurchasesHt DESC`,
    ...curClause.params,
  )

  let cumulativePurchases = 0
  const supplierConcentrationPareto = supplierRows.map((s, idx) => {
    const val = round3(s.totalPurchasesHt)
    cumulativePurchases += val
    return {
      rank: idx + 1,
      name: s.name,
      purchasesHt: val,
      cumulativeSharePct: totalPurchasesHt > 0 ? round1((cumulativePurchases / totalPurchasesHt) * 100) ?? 100 : 0,
    }
  })

  const topSuppliers = supplierRows.slice(0, 20).map((s) => {
    const val = round3(s.totalPurchasesHt)
    return {
      id: s.id,
      name: s.name,
      city: s.city,
      totalPurchasesHt: val,
      sharePct: totalPurchasesHt > 0 ? round1((val / totalPurchasesHt) * 100) ?? 0 : 0,
      invoicesCount: s.invoicesCount,
      paymentTermsDays: s.paymentTermsDays ?? 30,
    }
  })

  const top3Purchases = supplierRows.slice(0, 3).reduce((sum, s) => sum + s.totalPurchasesHt, 0)
  const supplierConcentrationTop3Pct = totalPurchasesHt > 0 ? round1((top3Purchases / totalPurchasesHt) * 100) ?? 0 : 0

  // 5. Price Evolution Alerts (detect unit cost hikes between oldest and latest invoice in period)
  const priceAlertsRaw = db.all<{
    productId: string
    sku: string
    productName: string
    supplierName: string
    firstCost: number
    latestCost: number
    totalQty: number
  }>(
    `SELECT p.id productId, p.sku, p.name productName, sup.name supplierName,
            (SELECT l1.unit_cost FROM supplier_invoice_lines l1
               JOIN supplier_invoices f1 ON f1.id = l1.supplier_invoice_id
              WHERE l1.product_id = p.id AND f1.supplier_id = sup.id AND f1.status != 'cancelled'
                AND f1.invoice_date BETWEEN ? AND ?
              ORDER BY f1.invoice_date ASC LIMIT 1) firstCost,
            (SELECT l2.unit_cost FROM supplier_invoice_lines l2
               JOIN supplier_invoices f2 ON f2.id = l2.supplier_invoice_id
              WHERE l2.product_id = p.id AND f2.supplier_id = sup.id AND f2.status != 'cancelled'
                AND f2.invoice_date BETWEEN ? AND ?
              ORDER BY f2.invoice_date DESC LIMIT 1) latestCost,
            sum(l.quantity) totalQty
       FROM supplier_invoice_lines l
       JOIN supplier_invoices f ON f.id = l.supplier_invoice_id
       JOIN products p ON p.id = l.product_id
       JOIN suppliers sup ON sup.id = f.supplier_id
      WHERE f.status != 'cancelled' AND ${curClause.whereClause}
      GROUP BY p.id, sup.id
      HAVING firstCost IS NOT NULL AND latestCost IS NOT NULL AND latestCost > firstCost * 1.03`,
    range.from,
    range.to,
    range.from,
    range.to,
    ...curClause.params,
  )

  const priceEvolutionAlerts = priceAlertsRaw.slice(0, 15).map((a) => {
    const initCost = round3(a.firstCost)
    const endCost = round3(a.latestCost)
    const inflation = round1(((endCost - initCost) / initCost) * 100) ?? 0
    const impact = round3((endCost - initCost) * a.totalQty)
    return {
      productId: a.productId,
      sku: a.sku,
      productName: a.productName,
      supplierName: a.supplierName,
      initialUnitCost: initCost,
      latestUnitCost: endCost,
      inflationPct: inflation,
      impactDt: impact,
    }
  })

  // 6. Recent Purchase Orders
  const recentPurchaseOrders = db.all<{
    id: string
    orderDate: string
    supplier: string
    agency: string
    status: string
    totalHt: number
  }>(
    `SELECT po.id, po.order_date orderDate, s.name supplier, a.name agency, po.status, po.total_ht totalHt
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN agencies a ON a.id = po.agency_id
      WHERE ${poClause.whereClause}
      ORDER BY po.order_date DESC LIMIT 20`,
    ...poClause.params,
  ).map((po) => ({
    id: po.id,
    date: po.orderDate,
    supplier: po.supplier,
    agency: po.agency,
    status: po.status,
    totalHt: round3(po.totalHt),
  }))

  return {
    asOf,
    range,
    previousRange,
    kpis: {
      totalPurchasesHt,
      purchasesGrowthPct: prevTotalHt ? calcPctChange(totalPurchasesHt, prevTotalHt) : null,
      activeSuppliersCount: curTotals.activeSuppliersCount,
      supplierConcentrationTop3Pct,
      totalPurchaseOrders: poStats.count,
      openOrdersValue: round3(poStats.totalHt),
    },
    monthlyPurchases,
    topSuppliers,
    supplierConcentrationPareto: supplierConcentrationPareto.slice(0, 30),
    priceEvolutionAlerts,
    recentPurchaseOrders,
  }
}
