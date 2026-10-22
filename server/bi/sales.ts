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
import type { BiUniversalFilters, SalesIntelligenceResponse } from "./types.js"

export function computeSalesIntelligence(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): SalesIntelligenceResponse {
  const { asOf, range, previousRange } = resolvePeriodDates(db, filters.period, filters.from, filters.to)
  const currentFilters: BiUniversalFilters = { ...filters, from: range.from, to: range.to }
  const prevFilters: BiUniversalFilters = previousRange ? { ...filters, from: previousRange.from, to: previousRange.to } : {}

  const inScope = db.scopeFilter(scope)

  // 1. Overall Sales KPIs
  const curClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "s.agency_id",
    dateCol: "s.invoice_date",
    customerCol: "s.customer_id",
    categoryCol: "p.category_id",
    productCol: "p.id",
    repCol: "s.representative_id",
  })

  const curTotals = db.one<{
    totalHt: number
    invoicesCount: number
    activeCustomersCount: number
    totalDiscounts: number
    totalGrossPrice: number
  }>(
    `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) totalHt,
            count(DISTINCT s.id) invoicesCount,
            count(DISTINCT s.customer_id) activeCustomersCount,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -1 ELSE 1 END * (l.quantity * l.unit_price - l.line_ht)), 0) totalDiscounts,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -1 ELSE 1 END * (l.quantity * l.unit_price)), 0) totalGrossPrice
       FROM sales_invoices s
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}`,
    ...curClause.params,
  )

  let prevTotalHt: number | null = null
  if (previousRange) {
    const prevClause = buildFilterClauses(db, scope, prevFilters, {
      agencyCol: "s.agency_id",
      dateCol: "s.invoice_date",
      customerCol: "s.customer_id",
      categoryCol: "p.category_id",
      productCol: "p.id",
      repCol: "s.representative_id",
    })
    prevTotalHt = db.one<{ totalHt: number }>(
      `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) totalHt
         FROM sales_invoices s
         JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
         JOIN products p ON p.id = l.product_id
        WHERE s.status = 'posted' AND ${prevClause.whereClause}`,
      ...prevClause.params,
    ).totalHt
  }

  // Count new customers who made their first purchase within the current period
  const newCustomersCount = db.one<{ n: number }>(
    `SELECT count(DISTINCT s.customer_id) n
       FROM sales_invoices s
      WHERE s.status = 'posted' AND s.invoice_date BETWEEN ? AND ? AND ${inScope("s.agency_id")}
        AND s.customer_id NOT IN (
          SELECT DISTINCT customer_id FROM sales_invoices
           WHERE status = 'posted' AND invoice_date < ?
        )`,
    range.from,
    range.to,
    range.from,
  ).n

  const totalSalesHt = round3(curTotals.totalHt)
  const averageOrderValue = curTotals.invoicesCount > 0 ? round3(totalSalesHt / curTotals.invoicesCount) : 0
  const averageDiscountPct = curTotals.totalGrossPrice > 0 ? round1((curTotals.totalDiscounts / curTotals.totalGrossPrice) * 100) ?? 0 : 0

  // 2. Monthly Trend (Revenue, Invoices, Average Basket)
  const monthlyTrend = db.all<{
    month: string
    revenue: number
    ordersCount: number
  }>(
    `SELECT substr(s.invoice_date, 1, 7) month,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            count(DISTINCT s.id) ordersCount
       FROM sales_invoices s
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY month ORDER BY month ASC`,
    ...curClause.params,
  ).map((m) => ({
    month: m.month,
    revenue: round3(m.revenue),
    ordersCount: m.ordersCount,
    averageBasket: m.ordersCount > 0 ? round3(m.revenue / m.ordersCount) : 0,
  }))

  // 3. Top Customers & Pareto Analysis
  const customerRows = db.all<{
    id: string
    name: string
    agency: string
    segment: string
    revenue: number
    cost: number
    invoicesCount: number
  }>(
    `SELECT c.id, c.name, a.name agency, coalesce(c.segment, 'Standard') segment,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost,
            count(DISTINCT s.id) invoicesCount
       FROM customers c
       JOIN sales_invoices s ON s.customer_id = c.id
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN agencies a ON a.id = s.agency_id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY c.id ORDER BY revenue DESC`,
    ...curClause.params,
  )

  let cumulativeRevenue = 0
  const paretoCustomers = customerRows.map((c, idx) => {
    const rev = round3(c.revenue)
    cumulativeRevenue += rev
    const cumulativeSharePct = totalSalesHt > 0 ? round1((cumulativeRevenue / totalSalesHt) * 100) ?? 100 : 0
    let segment: "A" | "B" | "C" = "C"
    if (cumulativeSharePct <= 80) segment = "A"
    else if (cumulativeSharePct <= 95) segment = "B"
    return {
      rank: idx + 1,
      name: c.name,
      revenue: rev,
      cumulativeSharePct,
      segment,
    }
  })

  const topCustomers = customerRows.slice(0, 20).map((c) => {
    const rev = round3(c.revenue)
    const cost = round3(c.cost)
    const margin = rev - cost
    return {
      id: c.id,
      name: c.name,
      agency: c.agency,
      segment: c.segment,
      revenue: rev,
      sharePct: totalSalesHt > 0 ? round1((rev / totalSalesHt) * 100) ?? 0 : 0,
      invoicesCount: c.invoicesCount,
      marginPct: safePct(margin, rev),
    }
  })

  // 4. Top Products
  const topProducts = db.all<{
    id: string
    sku: string
    name: string
    category: string
    quantitySold: number
    revenue: number
    cost: number
  }>(
    `SELECT p.id, p.sku, p.name, pc.name category,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.quantity ELSE l.quantity END), 0) quantitySold,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM products p
       JOIN product_categories pc ON pc.id = p.category_id
       JOIN sales_invoice_lines l ON l.product_id = p.id
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY p.id ORDER BY revenue DESC LIMIT 20`,
    ...curClause.params,
  ).map((p) => {
    const rev = round3(p.revenue)
    const cost = round3(p.cost)
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      quantitySold: round1(p.quantitySold) ?? 0,
      revenue: rev,
      marginPct: safePct(rev - cost, rev),
    }
  })

  // 5. Sales by Commercial / Representative
  const salesByRep = db.all<{
    id: string
    name: string
    agency: string
    revenue: number
    cost: number
    invoicesCount: number
  }>(
    `SELECT r.id, r.name, a.name agency,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost,
            count(DISTINCT s.id) invoicesCount
       FROM representatives r
       JOIN sales_invoices s ON s.representative_id = r.id
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN agencies a ON a.id = r.agency_id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY r.id ORDER BY revenue DESC`,
    ...curClause.params,
  ).map((r) => {
    const rev = round3(r.revenue)
    const cost = round3(r.cost)
    return {
      id: r.id,
      name: r.name,
      agency: r.agency,
      revenue: rev,
      invoicesCount: r.invoicesCount,
      marginPct: safePct(rev - cost, rev),
    }
  })

  // 6. Sales by Category
  const salesByCategory = db.all<{
    categoryId: string
    name: string
    revenue: number
    cost: number
  }>(
    `SELECT pc.id categoryId, pc.name,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM product_categories pc
       JOIN products p ON p.id = pc.id OR p.category_id = pc.id
       JOIN sales_invoice_lines l ON l.product_id = p.id
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY pc.id ORDER BY revenue DESC`,
    ...curClause.params,
  ).map((cat) => {
    const rev = round3(cat.revenue)
    const cost = round3(cat.cost)
    return {
      categoryId: cat.categoryId,
      name: cat.name,
      revenue: rev,
      sharePct: totalSalesHt > 0 ? round1((rev / totalSalesHt) * 100) ?? 0 : 0,
      marginPct: safePct(rev - cost, rev),
    }
  })

  // 7. Customer Segments
  const customerSegments = db.all<{
    segment: string
    customersCount: number
    revenue: number
  }>(
    `SELECT coalesce(c.segment, 'Standard') segment,
            count(DISTINCT c.id) customersCount,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue
       FROM customers c
       JOIN sales_invoices s ON s.customer_id = c.id
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY segment ORDER BY revenue DESC`,
    ...curClause.params,
  ).map((seg) => {
    const rev = round3(seg.revenue)
    return {
      segment: seg.segment,
      customersCount: seg.customersCount,
      revenue: rev,
      sharePct: totalSalesHt > 0 ? round1((rev / totalSalesHt) * 100) ?? 0 : 0,
    }
  })

  return {
    asOf,
    range,
    previousRange,
    kpis: {
      totalSalesHt,
      salesGrowthPct: prevTotalHt ? calcPctChange(totalSalesHt, prevTotalHt) : null,
      totalInvoices: curTotals.invoicesCount,
      averageOrderValue,
      activeCustomersCount: curTotals.activeCustomersCount,
      newCustomersCount,
      totalDiscountsGranted: round3(curTotals.totalDiscounts),
      averageDiscountPct,
    },
    monthlyTrend,
    topCustomers,
    paretoCustomers: paretoCustomers.slice(0, 30),
    topProducts,
    salesByRep,
    salesByCategory,
    customerSegments,
  }
}
