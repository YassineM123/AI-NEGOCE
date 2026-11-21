import type { AgencyScope } from "../auth.js"
import { ErpDatabase, periodRange, shiftMonth, shiftYear, shiftDays } from "../erp-db.js"
import type { BiUniversalFilters, BiUniversalPeriod, MetricDefinition } from "./types.js"

export const toM = (x: number): number => Math.round((Number.isFinite(x) ? x : 0) * 1000)
export const fromM = (m: number): number => Math.round(m) / 1000
export const round3 = (n: number): number => Math.round(n * 1000) / 1000
export const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10)

export function safeDiv(num: number, den: number): number | null {
  if (!den || !Number.isFinite(den) || !Number.isFinite(num)) return null
  return num / den
}

export function safePct(num: number, den: number): number | null {
  const d = safeDiv(num, den)
  return d === null ? null : round1(d * 100)
}

export function calcPctChange(cur: number, old: number | null): number | null {
  if (old === null || old === 0) return null
  return round1(((cur - old) / Math.abs(old)) * 100)
}

/** Authoritative Metric Catalog defining official definitions and formulas. */
export const METRIC_CATALOG: Record<string, MetricDefinition> = {
  KPI_REV_HT: {
    id: "KPI_REV_HT",
    name: "Chiffre d'affaires net HT",
    shortLabel: "CA HT",
    description: "Montant total facturé net de remises et hors taxes, déduction faite des avoirs comptabilisés.",
    formula: "SUM(CASE doc_type WHEN 'credit_note' THEN -line_ht ELSE line_ht END)",
    unit: "DT",
    currency: "TND",
    sourceTables: ["sales_invoices", "sales_invoice_lines"],
    drillDownLevels: ["company", "agency", "rep", "customer", "product", "invoice"],
  },
  KPI_GROSS_MARGIN: {
    id: "KPI_GROSS_MARGIN",
    name: "Marge brute",
    shortLabel: "Marge brute",
    description: "Différence entre le chiffre d'affaires net HT et le coût de revient d'achat des articles vendus.",
    formula: "CA_HT - SUM(CASE doc_type WHEN 'credit_note' THEN -line_cost ELSE line_cost END)",
    unit: "DT",
    currency: "TND",
    sourceTables: ["sales_invoices", "sales_invoice_lines"],
    drillDownLevels: ["company", "agency", "rep", "customer", "product", "invoice"],
  },
  KPI_MARKUP_RATE: {
    id: "KPI_MARKUP_RATE",
    name: "Taux de marque",
    shortLabel: "Taux de marque",
    description: "Rentabilité commerciale exprimée en pourcentage du chiffre d'affaires HT.",
    formula: "(Marge_Brute / CA_HT) * 100",
    unit: "%",
    sourceTables: ["sales_invoice_lines"],
    drillDownLevels: ["company", "agency", "customer", "product"],
  },
  KPI_MARGIN_RATE: {
    id: "KPI_MARGIN_RATE",
    name: "Taux de marge",
    shortLabel: "Taux de marge",
    description: "Marge brute rapportée au coût d'achat des marchandises vendues (coefficient de gain).",
    formula: "(Marge_Brute / Coût_Achat) * 100",
    unit: "%",
    sourceTables: ["sales_invoice_lines"],
    drillDownLevels: ["company", "agency", "customer", "product"],
  },
  KPI_PURCHASES_HT: {
    id: "KPI_PURCHASES_HT",
    name: "Achats fournisseurs HT",
    shortLabel: "Achats HT",
    description: "Montant total des factures d'achat fournisseurs comptabilisées sur la période.",
    formula: "SUM(supplier_invoices.total_ht)",
    unit: "DT",
    currency: "TND",
    sourceTables: ["supplier_invoices"],
    drillDownLevels: ["company", "agency", "supplier", "invoice"],
  },
  KPI_RECEIVABLES_TOTAL: {
    id: "KPI_RECEIVABLES_TOTAL",
    name: "Créances clients totales",
    shortLabel: "Créances",
    description: "Total des factures clients non réglées à la date d'arrêté.",
    formula: "SUM(receivables.outstanding) WHERE outstanding > 0",
    unit: "DT",
    currency: "TND",
    sourceTables: ["receivables"],
    drillDownLevels: ["company", "agency", "customer", "invoice"],
  },
  KPI_RECEIVABLES_OVERDUE: {
    id: "KPI_RECEIVABLES_OVERDUE",
    name: "Créances échues en retard",
    shortLabel: "Créances échues",
    description: "Montant des créances dont la date d'échéance contractuelle est dépassée.",
    formula: "SUM(receivables.outstanding) WHERE due_date < asOf",
    unit: "DT",
    currency: "TND",
    sourceTables: ["receivables"],
    drillDownLevels: ["company", "agency", "customer", "invoice"],
  },
  KPI_DSO: {
    id: "KPI_DSO",
    name: "Délai moyen de paiement client (DSO)",
    shortLabel: "DSO",
    description: "Nombre de jours de chiffre d'affaires TTC immobilisé dans les créances clients.",
    formula: "(Créances_TTC / CA_TTC_Période) * Nb_Jours",
    unit: "j",
    sourceTables: ["receivables", "sales_invoices"],
    drillDownLevels: ["company", "agency", "customer"],
  },
  KPI_INVENTORY_VALUATION: {
    id: "KPI_INVENTORY_VALUATION",
    name: "Valeur du stock physique",
    shortLabel: "Valeur stock",
    description: "Valorisation du stock disponible au coût d'achat unitaire de référence.",
    formula: "SUM(inventory.current_quantity * inventory.unit_cost)",
    unit: "DT",
    currency: "TND",
    sourceTables: ["inventory"],
    drillDownLevels: ["company", "agency", "category", "product"],
  },
  KPI_DORMANT_INVENTORY: {
    id: "KPI_DORMANT_INVENTORY",
    name: "Valeur du stock dormant (> 180 j)",
    shortLabel: "Stock dormant",
    description: "Stock sans aucun mouvement de vente depuis plus de 180 jours.",
    formula: "SUM(inventory.current_quantity * unit_cost) WHERE age > 180 or never sold",
    unit: "DT",
    currency: "TND",
    sourceTables: ["inventory", "stock_movements"],
    drillDownLevels: ["company", "agency", "product"],
  },
  KPI_STOCK_TURNOVER: {
    id: "KPI_STOCK_TURNOVER",
    name: "Rotation du stock",
    shortLabel: "Rotation stock",
    description: "Nombre de rotations du stock moyen au cours de la période.",
    formula: "Coût_Des_Ventes_Période / Valeur_Stock",
    unit: "u",
    sourceTables: ["sales_invoice_lines", "inventory"],
    drillDownLevels: ["company", "agency", "category"],
  },
  KPI_STOCK_COVERAGE_DAYS: {
    id: "KPI_STOCK_COVERAGE_DAYS",
    name: "Couverture de stock",
    shortLabel: "Couverture",
    description: "Autonomie estimée du stock en jours de vente quotidienne moyenne.",
    formula: "Quantité_En_Stock / (Consommation_Journalière_90j)",
    unit: "j",
    sourceTables: ["inventory", "stock_movements"],
    drillDownLevels: ["company", "agency", "product"],
  },
  KPI_CASH_INFLOW: {
    id: "KPI_CASH_INFLOW",
    name: "Encaissements clients réels",
    shortLabel: "Encaissements",
    description: "Somme des règlements effectifs perçus des clients sur la période.",
    formula: "SUM(payments.amount)",
    unit: "DT",
    currency: "TND",
    sourceTables: ["payments"],
    drillDownLevels: ["company", "agency", "customer"],
  },
}

export function resolvePeriodDates(db: ErpDatabase, period: BiUniversalPeriod = "year", from?: string, to?: string) {
  const asOf = db.asOf()
  if (from && to && from <= to) {
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000))
    const prevFrom = shiftDays(from, -days)
    const prevTo = shiftDays(to, -days)
    return {
      asOf,
      period: "custom" as BiUniversalPeriod,
      range: { from, to },
      previousRange: { from: prevFrom, to: prevTo },
    }
  }

  if (period === "all") {
    const firstRow = db.one<{ d: string | null }>("SELECT min(invoice_date) d FROM sales_invoices")
    const firstDate = firstRow?.d ?? asOf
    return {
      asOf,
      period: "all" as BiUniversalPeriod,
      range: { from: firstDate < asOf ? firstDate : asOf, to: asOf },
      previousRange: null,
    }
  }

  const legacyPeriod = period === "custom" ? "year" : (period as "month" | "quarter" | "year")
  const range = periodRange(asOf, legacyPeriod)
  const prev = { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) }
  return {
    asOf,
    period,
    range,
    previousRange: prev,
  }
}

export interface SqlScopeClause {
  whereClause: string
  params: (string | number)[]
}

/** Builds parameter-safe SQL predicates for agency scoping and universal filters. */
export function buildFilterClauses(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters,
  tableAliases: {
    agencyCol?: string
    dateCol?: string
    customerCol?: string
    supplierCol?: string
    categoryCol?: string
    productCol?: string
    repCol?: string
  } = {},
): SqlScopeClause {
  const parts: string[] = []
  const params: (string | number)[] = []

  // Agency Scope & explicit agency filter
  const targetScope = filters.agency && filters.agency !== "all" ? [filters.agency] : scope
  const inScopePred = db.scopeFilter(targetScope)
  const agencyCol = tableAliases.agencyCol ?? "agency_id"
  parts.push(inScopePred(agencyCol))

  // Date range
  if (tableAliases.dateCol && filters.from) {
    parts.push(`${tableAliases.dateCol} >= ?`)
    params.push(filters.from)
  }
  if (tableAliases.dateCol && filters.to) {
    parts.push(`${tableAliases.dateCol} <= ?`)
    params.push(filters.to)
  }

  // Customer filter
  if (tableAliases.customerCol && filters.customerId) {
    parts.push(`${tableAliases.customerCol} = ?`)
    params.push(filters.customerId)
  }

  // Supplier filter
  if (tableAliases.supplierCol && filters.supplierId) {
    parts.push(`${tableAliases.supplierCol} = ?`)
    params.push(filters.supplierId)
  }

  // Category filter
  if (tableAliases.categoryCol && filters.categoryId) {
    parts.push(`${tableAliases.categoryCol} = ?`)
    params.push(filters.categoryId)
  }

  // Product filter
  if (tableAliases.productCol && filters.productId) {
    parts.push(`${tableAliases.productCol} = ?`)
    params.push(filters.productId)
  }

  // Representative filter
  if (tableAliases.repCol && filters.repId) {
    parts.push(`${tableAliases.repCol} = ?`)
    params.push(filters.repId)
  }

  return {
    whereClause: parts.length > 0 ? parts.join(" AND ") : "1=1",
    params,
  }
}
