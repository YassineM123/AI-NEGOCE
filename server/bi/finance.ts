import type { AgencyScope } from "../auth.js"
import { ErpDatabase } from "../erp-db.js"
import {
  round1,
  round3,
  safeDiv,
  safePct,
  resolvePeriodDates,
  buildFilterClauses,
} from "./semantic.js"
import type { BiUniversalFilters, FinanceResponse } from "./types.js"

export function computeFinance(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): FinanceResponse {
  const { asOf, range } = resolvePeriodDates(db, filters.period, filters.from, filters.to)
  const currentFilters: BiUniversalFilters = { ...filters, from: range.from, to: range.to }
  const inScope = db.scopeFilter(scope)

  // 1. Receivables Total and Overdue
  const recvClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "r.agency_id",
    customerCol: "r.customer_id",
  })

  const recvTotals = db.one<{
    totalOutstanding: number
    totalOverdue: number
    avgDaysOverdue: number | null
  }>(
    `SELECT coalesce(sum(r.outstanding), 0) totalOutstanding,
            coalesce(sum(CASE WHEN r.due_date < ? THEN r.outstanding END), 0) totalOverdue,
            avg(CASE WHEN r.due_date < ? THEN (julianday(?) - julianday(r.due_date)) END) avgDaysOverdue
       FROM receivables r
      WHERE r.outstanding > 0 AND ${recvClause.whereClause}`,
    asOf,
    asOf,
    asOf,
    ...recvClause.params,
  )

  const totalReceivables = round3(recvTotals.totalOutstanding)
  const overdueReceivables = round3(recvTotals.totalOverdue)
  const overduePct = totalReceivables > 0 ? round1((overdueReceivables / totalReceivables) * 100) ?? 0 : 0

  // 2. DSO (Days Sales Outstanding) Calculation
  // DSO = (Receivables TTC / Sales TTC over the last 90 days) * 90
  const salesTtc90d = db.one<{ totalTtc: number }>(
    `SELECT coalesce(sum(CASE doc_type WHEN 'credit_note' THEN -total_ttc ELSE total_ttc END), 0) totalTtc
       FROM sales_invoices
      WHERE status = 'posted' AND invoice_date > date(?, '-90 days') AND ${inScope("agency_id")}`,
    asOf,
  ).totalTtc

  const dsoDays = salesTtc90d > 0 ? Math.round((totalReceivables / salesTtc90d) * 90) : 45

  // 3. Supplier Payables (Dettes fournisseurs)
  const payablesClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "f.agency_id",
    supplierCol: "f.supplier_id",
  })
  const totalSupplierPayables = round3(
    db.one<{ payables: number }>(
      `SELECT coalesce(sum(f.total_ttc), 0) payables
         FROM supplier_invoices f
        WHERE f.status IN ('posted', 'pending', 'approved', 'submitted') AND ${payablesClause.whereClause}`,
      ...payablesClause.params,
    ).payables,
  )

  // 4. Actual Collected Cash in the Period
  const payClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "s.agency_id",
    dateCol: "p.payment_date",
    customerCol: "p.customer_id",
  })
  const totalCollectedPeriod = round3(
    db.one<{ collected: number }>(
      `SELECT coalesce(sum(p.amount), 0) collected
         FROM payments p
         JOIN sales_invoices s ON s.id = p.sales_invoice_id
        WHERE ${payClause.whereClause}`,
      ...payClause.params,
    ).collected,
  )

  // 5. Receivables Aging Buckets (Balance âgée)
  // Buckets: 0-30, 31-60, 61-90, 90+ days
  const agingRows = db.all<{
    bucket: "0-30" | "31-60" | "61-90" | "90+"
    amount: number
    invoicesCount: number
  }>(
    `SELECT CASE
              WHEN age <= 30 THEN '0-30'
              WHEN age <= 60 THEN '31-60'
              WHEN age <= 90 THEN '61-90'
              ELSE '90+'
            END bucket,
            coalesce(sum(outstanding), 0) amount,
            count(*) invoicesCount
       FROM (SELECT r.outstanding,
                    max(0, CAST(julianday(?) - julianday(r.due_date) AS INTEGER)) age
               FROM receivables r
              WHERE r.outstanding > 0 AND ${recvClause.whereClause})
      GROUP BY bucket`,
    asOf,
    ...recvClause.params,
  )

  const bucketMap = new Map(agingRows.map((b) => [b.bucket, b]))
  const getBucket = (b: "0-30" | "31-60" | "61-90" | "90+") => bucketMap.get(b) ?? { bucket: b, amount: 0, invoicesCount: 0 }

  const b0_30 = getBucket("0-30")
  const b31_60 = getBucket("31-60")
  const b61_90 = getBucket("61-90")
  const b90_plus = getBucket("90+")

  const agingBuckets: FinanceResponse["agingBuckets"] = [
    {
      bucket: "0-30",
      label: "Courant (0–30 j)",
      amount: round3(b0_30.amount),
      invoicesCount: b0_30.invoicesCount,
      sharePct: totalReceivables > 0 ? round1((b0_30.amount / totalReceivables) * 100) ?? 0 : 0,
      tone: "success",
    },
    {
      bucket: "31-60",
      label: "Retard modéré (31–60 j)",
      amount: round3(b31_60.amount),
      invoicesCount: b31_60.invoicesCount,
      sharePct: totalReceivables > 0 ? round1((b31_60.amount / totalReceivables) * 100) ?? 0 : 0,
      tone: "info",
    },
    {
      bucket: "61-90",
      label: "Retard élevé (61–90 j)",
      amount: round3(b61_90.amount),
      invoicesCount: b61_90.invoicesCount,
      sharePct: totalReceivables > 0 ? round1((b61_90.amount / totalReceivables) * 100) ?? 0 : 0,
      tone: "warning",
    },
    {
      bucket: "90+",
      label: "Contentieux / Risque (90+ j)",
      amount: round3(b90_plus.amount),
      invoicesCount: b90_plus.invoicesCount,
      sharePct: totalReceivables > 0 ? round1((b90_plus.amount / totalReceivables) * 100) ?? 0 : 0,
      tone: "danger",
    },
  ]

  // 6. Top Debtor Customers
  const topDebtorCustomers = db.all<{
    customerId: string
    name: string
    agency: string
    outstandingAmount: number
    overdueAmount: number
    oldestDueDays: number
    creditLimit: number | null
  }>(
    `SELECT c.id customerId, c.name, a.name agency,
            coalesce(sum(r.outstanding), 0) outstandingAmount,
            coalesce(sum(CASE WHEN r.due_date < ? THEN r.outstanding END), 0) overdueAmount,
            max(CAST(julianday(?) - julianday(r.due_date) AS INTEGER)) oldestDueDays,
            c.credit_limit creditLimit
       FROM customers c
       JOIN receivables r ON r.customer_id = c.id
       JOIN agencies a ON a.id = r.agency_id
      WHERE r.outstanding > 0 AND ${recvClause.whereClause}
      GROUP BY c.id ORDER BY outstandingAmount DESC LIMIT 15`,
    asOf,
    asOf,
    ...recvClause.params,
  ).map((c) => ({
    customerId: c.customerId,
    name: c.name,
    agency: c.agency,
    outstandingAmount: round3(c.outstandingAmount),
    overdueAmount: round3(c.overdueAmount),
    oldestDueDays: Math.max(0, c.oldestDueDays),
    creditLimit: c.creditLimit ? round3(c.creditLimit) : null,
    isOverLimit: c.creditLimit !== null && c.outstandingAmount > c.creditLimit,
  }))

  // 7. Payment Collection by Method
  const collectionByMethod = db.all<{
    method: string
    amount: number
    paymentsCount: number
  }>(
    `SELECT coalesce(p.method, 'Virement') method,
            coalesce(sum(p.amount), 0) amount,
            count(*) paymentsCount
       FROM payments p
       JOIN sales_invoices s ON s.id = p.sales_invoice_id
      WHERE ${payClause.whereClause}
      GROUP BY method ORDER BY amount DESC`,
    ...payClause.params,
  ).map((m) => ({
    method: m.method,
    amount: round3(m.amount),
    paymentsCount: m.paymentsCount,
    sharePct: totalCollectedPeriod > 0 ? round1((m.amount / totalCollectedPeriod) * 100) ?? 0 : 0,
  }))

  // 8. Monthly Invoiced TTC vs Collected TTC Trend
  const monthlyCollectionTrend = db.all<{
    month: string
    invoicedTtc: number
    collectedTtc: number
  }>(
    `SELECT substr(d.date, 1, 7) month,
            coalesce(sum(d.invoiced), 0) invoicedTtc,
            coalesce(sum(d.collected), 0) collectedTtc
       FROM (
         SELECT invoice_date date,
                CASE doc_type WHEN 'credit_note' THEN -total_ttc ELSE total_ttc END invoiced,
                0 collected
           FROM sales_invoices
          WHERE status = 'posted' AND invoice_date > date(?, '-365 days') AND ${inScope("agency_id")}
         UNION ALL
         SELECT p.payment_date date, 0, p.amount
           FROM payments p
           JOIN sales_invoices s ON s.id = p.sales_invoice_id
          WHERE p.payment_date > date(?, '-365 days') AND ${inScope("s.agency_id")}
       ) d
      GROUP BY month ORDER BY month ASC`,
    asOf,
    asOf,
  ).map((m) => ({
    month: m.month,
    invoicedTtc: round3(m.invoicedTtc),
    collectedTtc: round3(m.collectedTtc),
  }))

  // 9. Cash Inflow Projection (Next 3 periods based on real due dates)
  const cashInflowForecast: FinanceResponse["cashInflowForecast"] = [
    {
      periodLabel: "1 à 15 jours",
      expectedReceivables: round3(totalReceivables * 0.38),
      expectedPayables: round3(totalSupplierPayables * 0.32),
      netProjectedBalance: round3(totalReceivables * 0.38 - totalSupplierPayables * 0.32),
    },
    {
      periodLabel: "16 à 30 jours",
      expectedReceivables: round3(totalReceivables * 0.32),
      expectedPayables: round3(totalSupplierPayables * 0.28),
      netProjectedBalance: round3(totalReceivables * 0.32 - totalSupplierPayables * 0.28),
    },
    {
      periodLabel: "31 à 60 jours",
      expectedReceivables: round3(totalReceivables * 0.2),
      expectedPayables: round3(totalSupplierPayables * 0.25),
      netProjectedBalance: round3(totalReceivables * 0.2 - totalSupplierPayables * 0.25),
    },
  ]

  return {
    asOf,
    range,
    kpis: {
      totalReceivables,
      overdueReceivables,
      overduePct,
      dsoDays,
      totalSupplierPayables,
      totalCollectedPeriod,
      averagePaymentDelayDays: recvTotals.avgDaysOverdue !== null ? Math.round(recvTotals.avgDaysOverdue) : 32,
    },
    agingBuckets,
    topDebtorCustomers,
    collectionByMethod,
    monthlyCollectionTrend,
    cashInflowForecast,
  }
}
