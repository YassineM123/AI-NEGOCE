/**
 * Descriptive, read-only aggregates for BI and Data Science, based exclusively
 * on the SAME authorized Dataset, agency scope and period as /analytics/overview.
 * No ML predictions, automatic actions or inferred ERP joins.
 */
import { filteredSales, type Dataset, type Filters } from "./services.js"

const toMillimes = (value: number) => Math.round(value * 1000)
const decimal = (millimes: number) => millimes / 1000
const utcDays = (start: string, end: string) =>
  Math.max(0, Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000))
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
  .toISOString().slice(0, 10)

export function buildAnalyticsInsights(dataset: Dataset, filters: Filters = {}) {
  const sales = filteredSales(filters, dataset)
  const asOf = dataset.metadata.asOf ?? new Date().toISOString().slice(0, 10)
  const referenceDate = filters.to && filters.to < asOf ? filters.to : asOf
  const isPseudonymizedExtract = dataset.metadata.source.includes("Database/extractions")
  const byMonth = new Map<string, { total: number; documents: Set<string>; customers: Set<string> }>()
  const byCustomer = new Map<string, {
    id: string; name: string; total: number; documents: Set<string>; lastPurchase: string
  }>()
  let total = 0
  let costKnownRows = 0
  for (const row of sales) {
    const value = toMillimes(row.revenue)
    total += value
    if (row.cost !== null && row.cost !== undefined) costKnownRows++
    const customerId = row.customerId ?? row.customer
    const month = row.date.slice(0, 7)
    const monthly = byMonth.get(month) ?? { total: 0, documents: new Set<string>(), customers: new Set<string>() }
    monthly.total += value
    monthly.documents.add(row.invoiceId)
    monthly.customers.add(customerId)
    byMonth.set(month, monthly)
    const customerKey = JSON.stringify([row.agency,customerId])
    const customer = byCustomer.get(customerKey) ?? {
      id: customerId, name: row.customer, total: 0,
      documents: new Set<string>(), lastPurchase: row.date,
    }
    customer.total += value
    customer.documents.add(row.invoiceId)
    if (row.date > customer.lastPurchase) customer.lastPurchase = row.date
    byCustomer.set(customerKey, customer)
  }
  const allMonths = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
  const months = allMonths.slice(-36).map(([month, v]) => ({
    month,
    revenue: decimal(v.total),
    documents: v.documents.size,
    customers: v.customers.size,
    closed: month < asOf.slice(0, 7) &&
      (!filters.from || filters.from <= month + "-01") &&
      (!filters.to || filters.to >= lastDay(month)),
  }))
  const sortedCustomers = [...byCustomer.values()].sort((a, b) =>
    b.total - a.total || a.id.localeCompare(b.id))
  const topCustomers = sortedCustomers.slice(0, 10).map((v) => ({
    id: v.id,
    name: v.name,
    revenue: decimal(v.total),
    documents: v.documents.size,
    lastPurchase: v.lastPurchase,
    daysSinceLastPurchase: utcDays(v.lastPurchase, referenceDate),
    sharePercent: total > 0 ? Math.round(v.total / total * 10000) / 100 : null,
  }))
  const topFiveSharePercent = total > 0
    ? Math.round(sortedCustomers.slice(0, 5).reduce((n, c) => n + c.total, 0) / total * 10000) / 100
    : null
  const closedMonths = months.filter((m) => m.closed)
  const last = closedMonths.at(-1)
  const previous = closedMonths.at(-2)
  const monthlyChangePercent = last && previous &&
    previous.revenue > 0 &&
    Number(last.month.slice(0, 4)) * 12 + Number(last.month.slice(5, 7)) -
      (Number(previous.month.slice(0, 4)) * 12 + Number(previous.month.slice(5, 7))) === 1
    ? Math.round((last.revenue - previous.revenue) / previous.revenue * 10000) / 100
    : null
  return {
    currency: "TND" as const,
    basis: "posted_sales_net_ht" as const,
    referenceDate,
    months,
    topCustomers,
    summary: {
      revenue: decimal(total),
      salesRows: sales.length,
      documentCount: new Set(sales.map((s) => s.invoiceId)).size,
      customerCount: byCustomer.size,
      topFiveSharePercent,
      monthlyChangePercent,
      historyTruncated: allMonths.length > 36,
    },
    coverage: {
      costKnownRows,
      costMissingRows: sales.length - costKnownRows,
      receivablesAvailable: !isPseudonymizedExtract,
      inventoryValuationAvailable: !isPseudonymizedExtract,
      agencyAttributionAvailable: !isPseudonymizedExtract,
      invoiceItemLinksAvailable: !isPseudonymizedExtract,
      modelServingVerified: false as const,
    },
    warnings: [
      "Analyse descriptive déterministe, pas de modèle ML ni de prédiction validée.",
      ...(isPseudonymizedExtract ? [
        "Extraits IAINEG pseudonymisés : journal TND uniquement ; EUR et USD exclus.",
        "Aucune ventilation de ventes par dépôt, coûts par facture, échéances par facture ou PMP utilisable.",
        "Les mois en cours et les mois tronqués par le filtre ne sont pas marqués clôturés.",
        "Données SQL non rapprochées avec les éditions officielles de l'ERP LAI.",
      ] : []),
    ],
  }
}
