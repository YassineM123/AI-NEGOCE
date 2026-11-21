import type { AgencyScope } from "../auth.js"
import { ErpDatabase, shiftMonth } from "../erp-db.js"
import {
  calcPctChange,
  fromM,
  round1,
  round3,
  safeDiv,
  safePct,
  toM,
  resolvePeriodDates,
  buildFilterClauses,
} from "./semantic.js"
import type {
  BiUniversalFilters,
  BusinessAlert,
  CockpitKpiCard,
  ExecutiveCockpitResponse,
} from "./types.js"

export function computeExecutiveCockpit(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): ExecutiveCockpitResponse {
  const { asOf, period, range, previousRange } = resolvePeriodDates(db, filters.period, filters.from, filters.to)
  const currentFilters: BiUniversalFilters = { ...filters, from: range.from, to: range.to }
  const prevFilters: BiUniversalFilters = previousRange ? { ...filters, from: previousRange.from, to: previousRange.to } : {}

  const inScope = db.scopeFilter(scope)

  // 1. Sales & Gross Margin (Current Period)
  const curSalesClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "s.agency_id",
    dateCol: "s.invoice_date",
    customerCol: "s.customer_id",
    categoryCol: "p.category_id",
    productCol: "p.id",
    repCol: "s.representative_id",
  })

  const curSales = db.one<{
    revenue: number
    cost: number
    invoicesCount: number
  }>(
    `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost,
            count(DISTINCT s.id) invoicesCount
       FROM sales_invoices s
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curSalesClause.whereClause}`,
    ...curSalesClause.params,
  )

  // Previous Period Sales
  let prevSales = { revenue: 0, cost: 0, invoicesCount: 0 }
  if (previousRange) {
    const prevSalesClause = buildFilterClauses(db, scope, prevFilters, {
      agencyCol: "s.agency_id",
      dateCol: "s.invoice_date",
      customerCol: "s.customer_id",
      categoryCol: "p.category_id",
      productCol: "p.id",
      repCol: "s.representative_id",
    })
    prevSales = db.one<{ revenue: number; cost: number; invoicesCount: number }>(
      `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
              coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost,
              count(DISTINCT s.id) invoicesCount
         FROM sales_invoices s
         JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
         JOIN products p ON p.id = l.product_id
        WHERE s.status = 'posted' AND ${prevSalesClause.whereClause}`,
      ...prevSalesClause.params,
    )
  }

  const curRevenue = round3(curSales.revenue)
  const curCost = round3(curSales.cost)
  const curMargin = round3(curRevenue - curCost)
  const prevRevenue = previousRange ? round3(prevSales.revenue) : null
  const prevCost = previousRange ? round3(prevSales.cost) : null
  const prevMargin = previousRange ? round3((prevRevenue ?? 0) - (prevCost ?? 0)) : null

  const curMarkupRate = safePct(curMargin, curRevenue) // Taux de marque
  const prevMarkupRate = prevRevenue ? safePct(prevMargin ?? 0, prevRevenue) : null
  const curMarginRate = safePct(curMargin, curCost) // Taux de marge
  const prevMarginRate = prevCost ? safePct(prevMargin ?? 0, prevCost) : null

  // 2. Purchases (Current & Previous)
  const curPurchClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "f.agency_id",
    dateCol: "f.invoice_date",
    supplierCol: "f.supplier_id",
  })
  const curPurchases = db.one<{ totalHt: number }>(
    `SELECT coalesce(sum(f.total_ht), 0) totalHt
       FROM supplier_invoices f
      WHERE f.status != 'cancelled' AND ${curPurchClause.whereClause}`,
    ...curPurchClause.params,
  ).totalHt

  let prevPurchases: number | null = null
  if (previousRange) {
    const prevPurchClause = buildFilterClauses(db, scope, prevFilters, {
      agencyCol: "f.agency_id",
      dateCol: "f.invoice_date",
      supplierCol: "f.supplier_id",
    })
    prevPurchases = db.one<{ totalHt: number }>(
      `SELECT coalesce(sum(f.total_ht), 0) totalHt
         FROM supplier_invoices f
        WHERE f.status != 'cancelled' AND ${prevPurchClause.whereClause}`,
      ...prevPurchClause.params,
    ).totalHt
  }

  // 3. Receivables & Overdue
  const recvClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "r.agency_id",
    customerCol: "r.customer_id",
  })
  const receivables = db.one<{ outstanding: number; overdue: number }>(
    `SELECT coalesce(sum(r.outstanding), 0) outstanding,
            coalesce(sum(CASE WHEN r.due_date < ? THEN r.outstanding END), 0) overdue
       FROM receivables r
      WHERE r.outstanding > 0 AND ${recvClause.whereClause}`,
    asOf,
    ...recvClause.params,
  )

  // 4. Supplier Payables (Dettes fournisseurs)
  const payablesClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "f.agency_id",
    supplierCol: "f.supplier_id",
  })
  const payables = db.one<{ totalPayables: number }>(
    `SELECT coalesce(sum(f.total_ttc), 0) totalPayables
       FROM supplier_invoices f
      WHERE f.status IN ('posted', 'pending', 'approved', 'submitted') AND ${payablesClause.whereClause}`,
    ...payablesClause.params,
  ).totalPayables

  // 5. Inventory & Stock Dormant
  const invClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "i.agency_id",
    categoryCol: "p.category_id",
    productCol: "p.id",
  })
  const stockSummary = db.one<{ totalValue: number }>(
    `SELECT coalesce(sum(i.current_quantity * i.unit_cost), 0) totalValue
       FROM inventory i
       JOIN products p ON p.id = i.product_id
      WHERE i.current_quantity > 0 AND ${invClause.whereClause}`,
    ...invClause.params,
  ).totalValue

  const stockAging = db.one<{ active: number; watch: number; dormant: number }>(
    `SELECT coalesce(sum(CASE WHEN age < 90 THEN val END), 0) active,
            coalesce(sum(CASE WHEN age BETWEEN 90 AND 180 THEN val END), 0) watch,
            coalesce(sum(CASE WHEN age IS NULL OR age > 180 THEN val END), 0) dormant
       FROM (SELECT i.current_quantity * i.unit_cost val,
                    julianday(?) - julianday((SELECT max(m.date) FROM stock_movements m
                      WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale')) age
               FROM inventory i
               JOIN products p ON p.id = i.product_id
              WHERE i.current_quantity > 0 AND ${invClause.whereClause})`,
    asOf,
    ...invClause.params,
  )

  // 6. Cash Inflows (Encaissements réels sur la période)
  const payClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "s.agency_id",
    dateCol: "p.payment_date",
    customerCol: "p.customer_id",
  })
  const cashInflow = db.one<{ totalCollected: number }>(
    `SELECT coalesce(sum(p.amount), 0) totalCollected
       FROM payments p
       JOIN sales_invoices s ON s.id = p.sales_invoice_id
      WHERE ${payClause.whereClause}`,
    ...payClause.params,
  ).totalCollected

  // 7. Open Purchase Orders (Commandes fournisseurs en cours)
  const poClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "po.agency_id",
    supplierCol: "po.supplier_id",
  })
  const openOrders = db.one<{ count: number; totalHt: number }>(
    `SELECT count(*) count, coalesce(sum(po.total_ht), 0) totalHt
       FROM purchase_orders po
      WHERE po.status IN ('draft', 'pending', 'approved', 'open') AND ${poClause.whereClause}`,
    ...poClause.params,
  )

  // 8. Commercial Objectives & Achievement
  // Baseline target: previous period revenue + 8% target growth, or current revenue * 1.05 if no prev
  const targetRevenue = prevRevenue && prevRevenue > 0 ? round3(prevRevenue * 1.08) : round3(curRevenue * 1.05)
  const targetAchievementRate = safePct(curRevenue, targetRevenue)

  // 9. 12-Month Monthly Trend (CA, Marge, Achats)
  const trendStart = shiftMonth(asOf, -11).slice(0, 7) + "-01"
  const monthlyTrend = db.all<{ month: string; revenue: number; cost: number; purchases: number }>(
    `SELECT substr(d.date, 1, 7) month,
            coalesce(sum(d.sales_ht), 0) revenue,
            coalesce(sum(d.sales_cost), 0) cost,
            coalesce(sum(d.purch_ht), 0) purchases
       FROM (
         SELECT s.invoice_date date,
                CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END sales_ht,
                CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END sales_cost,
                0 purch_ht
           FROM sales_invoices s
           JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
          WHERE s.status = 'posted' AND s.invoice_date BETWEEN ? AND ? AND ${inScope("s.agency_id")}
         UNION ALL
         SELECT f.invoice_date date, 0, 0, f.total_ht
           FROM supplier_invoices f
          WHERE f.status != 'cancelled' AND f.invoice_date BETWEEN ? AND ? AND ${inScope("f.agency_id")}
       ) d
      GROUP BY month ORDER BY month ASC`,
    trendStart,
    asOf,
    trendStart,
    asOf,
  ).map((m) => ({
    month: m.month,
    revenue: round3(m.revenue),
    margin: round3(m.revenue - m.cost),
    purchases: round3(m.purchases),
  }))

  // 10. Performance by Agency
  const agencyClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "a.id",
    dateCol: "s.invoice_date",
  })
  const agenciesPerformance = db.all<{
    agency: string
    revenue: number
    cost: number
    prevRevenue: number
  }>(
    `SELECT a.name agency,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END END), 0) revenue,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END END), 0) cost,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END END), 0) prevRevenue
       FROM agencies a
       LEFT JOIN sales_invoices s ON s.agency_id = a.id AND s.status = 'posted'
       LEFT JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
      WHERE ${inScope("a.id")}
      GROUP BY a.id ORDER BY revenue DESC`,
    range.from,
    range.to,
    range.from,
    range.to,
    previousRange?.from ?? "",
    previousRange?.to ?? "",
  ).map((a) => {
    const rev = round3(a.revenue)
    const cost = round3(a.cost)
    const m = round3(rev - cost)
    return {
      agency: a.agency,
      revenue: rev,
      margin: m,
      markupRate: safePct(m, rev),
      sharePct: curRevenue > 0 ? round1((rev / curRevenue) * 100)! : 0,
      growthPct: a.prevRevenue > 0 ? calcPctChange(rev, a.prevRevenue) : null,
    }
  })

  // 11. Alerts / Anomalies for Cockpit
  const anomalies: BusinessAlert[] = []
  if (curMarkupRate !== null && prevMarkupRate !== null && curMarkupRate < prevMarkupRate - 3) {
    anomalies.push({
      id: "alert_margin_drop_global",
      severity: "critical",
      category: "margin",
      title: "Chute globale du taux de marque",
      subject: `Taux actuel : ${curMarkupRate}% (vs ${prevMarkupRate}% en N-1)`,
      detail: `Perte de ${round1(prevMarkupRate - curMarkupRate)} points de marque sur la période.`,
      threshold: "-3.0 pts",
      detectedAt: asOf,
      linkAction: { tab: "profitability" },
    })
  }
  if (receivables.overdue > 1000) {
    anomalies.push({
      id: "alert_receivables_overdue",
      severity: "warning",
      category: "receivables",
      title: "Créances échues significatives",
      subject: `${round3(receivables.overdue)} DT échus`,
      detail: `${safePct(receivables.overdue, receivables.outstanding) ?? 0}% du total des créances clients est en retard.`,
      threshold: "> 1 000 DT",
      detectedAt: asOf,
      linkAction: { tab: "finance" },
    })
  }
  if (stockAging.dormant > 5000) {
    anomalies.push({
      id: "alert_dormant_stock",
      severity: "warning",
      category: "stock",
      title: "Immobilisation en stock dormant",
      subject: `${round3(stockAging.dormant)} DT (> 180 jours sans vente)`,
      detail: "Articles nécessitant un déstockage prioritaire ou promotion commerciale.",
      threshold: "> 5 000 DT",
      detectedAt: asOf,
      linkAction: { tab: "inventory" },
    })
  }

  // Construct structured KPI cards with formulas and metadata
  const kpis: ExecutiveCockpitResponse["kpis"] = {
    revenueHt: {
      id: "KPI_REV_HT",
      label: "Chiffre d’affaires HT",
      value: curRevenue,
      previousValue: prevRevenue,
      deltaPct: calcPctChange(curRevenue, prevRevenue),
      unit: "DT",
      subtitle: `${curSales.invoicesCount} facture(s) émise(s)`,
      tone: "blue",
      tooltip: "Ventes nettes facturées hors taxes, après déduction des avoirs",
      formula: "Somme(Lignes HT) - Somme(Avoirs HT)",
    },
    grossMargin: {
      id: "KPI_GROSS_MARGIN",
      label: "Marge brute",
      value: curMargin,
      previousValue: prevMargin,
      deltaPct: calcPctChange(curMargin, prevMargin),
      unit: "DT",
      subtitle: curMarkupRate !== null ? `${curMarkupRate} % du CA net` : "CA nul",
      tone: "green",
      tooltip: "Gain brut réalisé sur les ventes par rapport au coût de revient d'achat",
      formula: "CA Net HT - Coût des ventes HT",
    },
    markupRate: {
      id: "KPI_MARKUP_RATE",
      label: "Taux de marque",
      value: curMarkupRate ?? 0,
      previousValue: prevMarkupRate,
      deltaPct: null,
      deltaPts: prevMarkupRate !== null && curMarkupRate !== null ? round1(curMarkupRate - prevMarkupRate) : null,
      unit: "%",
      subtitle: prevMarkupRate !== null ? `vs ${prevMarkupRate} % en N-1` : "N-1 non dispo",
      tone: "green",
      tooltip: "Marge brute exprimée en pourcentage du chiffre d'affaires",
      formula: "(Marge Brute / CA HT) × 100",
    },
    marginRate: {
      id: "KPI_MARGIN_RATE",
      label: "Taux de marge",
      value: curMarginRate ?? 0,
      previousValue: prevMarginRate,
      deltaPct: null,
      deltaPts: prevMarginRate !== null && curMarginRate !== null ? round1(curMarginRate - prevMarginRate) : null,
      unit: "%",
      subtitle: "sur coût de revient",
      tone: "purple",
      tooltip: "Marge brute rapportée au coût d'achat des marchandises",
      formula: "(Marge Brute / Coût d'achat) × 100",
    },
    purchasesHt: {
      id: "KPI_PURCHASES_HT",
      label: "Achats fournisseurs HT",
      value: round3(curPurchases),
      previousValue: prevPurchases,
      deltaPct: calcPctChange(curPurchases, prevPurchases),
      unit: "DT",
      subtitle: "Factures d'achat validées",
      tone: "amber",
      tooltip: "Total des achats facturés par les fournisseurs sur la période",
      formula: "Somme(Factures fournisseurs HT)",
    },
    receivablesTotal: {
      id: "KPI_RECEIVABLES_TOTAL",
      label: "Créances clients",
      value: round3(receivables.outstanding),
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: "Soldes ouverts à recouvrer",
      tone: "blue",
      tooltip: "Total des factures clients émises et non encore soldées",
      formula: "Somme(Encours clients TTC)",
    },
    receivablesOverdue: {
      id: "KPI_RECEIVABLES_OVERDUE",
      label: "Créances échues",
      value: round3(receivables.overdue),
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: `${safePct(receivables.overdue, receivables.outstanding) ?? 0} % du total`,
      tone: "red",
      tooltip: "Factures dont la date d'échéance contractuelle est dépassée",
      formula: "Somme(Encours où date_échéance < as_of)",
    },
    supplierPayables: {
      id: "KPI_SUPPLIER_PAYABLES",
      label: "Dettes fournisseurs",
      value: round3(payables),
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: "Factures achat à payer",
      tone: "amber",
      tooltip: "Montant total TTC engagé auprès des fournisseurs",
      formula: "Somme(Factures fournisseurs TTC non soldées)",
    },
    inventoryValuation: {
      id: "KPI_INVENTORY_VALUATION",
      label: "Valeur du stock",
      value: round3(stockSummary),
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: "au coût d'achat unitaire",
      tone: "purple",
      tooltip: "Valorisation du stock physique présent dans les dépôts",
      formula: "Somme(Quantité × Coût unitaire)",
    },
    dormantInventory: {
      id: "KPI_DORMANT_INVENTORY",
      label: "Stock dormant (> 180 j)",
      value: round3(stockAging.dormant),
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: stockSummary > 0 ? `${round1((stockAging.dormant / stockSummary) * 100)} % du stock` : "0 %",
      tone: "red",
      tooltip: "Articles en stock sans aucun mouvement de vente depuis plus de 6 mois",
      formula: "Somme(Stock × Coût) où dernier_mouvement_vente > 180j",
    },
    cashInflow: {
      id: "KPI_CASH_INFLOW",
      label: "Encaissements réels",
      value: round3(cashInflow),
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: "Règlements encaissés",
      tone: "green",
      tooltip: "Total des encaissements enregistrés en banque ou caisse",
      formula: "Somme(Règlements perçus sur la période)",
    },
    openOrdersCount: {
      id: "KPI_OPEN_ORDERS",
      label: "Commandes achats en cours",
      value: openOrders.count,
      previousValue: null,
      deltaPct: null,
      unit: "u",
      subtitle: `${round3(openOrders.totalHt)} DT en commande`,
      tone: "blue",
      tooltip: "Bons de commande fournisseurs non encore réceptionnés ou facturés",
      formula: "Nombre de commandes achat à statut 'open'/'pending'",
    },
    salesTarget: {
      id: "KPI_SALES_TARGET",
      label: "Objectif commercial",
      value: targetRevenue,
      previousValue: null,
      deltaPct: null,
      unit: "DT",
      subtitle: "Budget fixé (+8 % vs N-1)",
      tone: "blue",
      tooltip: "Objectif de chiffre d'affaires assigné sur la période",
      formula: "Budget prévisionnel déterministe",
    },
    targetAchievementRate: {
      id: "KPI_TARGET_ACHIEVEMENT",
      label: "Réalisation objectif",
      value: targetAchievementRate ?? 0,
      previousValue: null,
      deltaPct: null,
      unit: "%",
      subtitle: curRevenue >= targetRevenue ? "Objectif atteint" : `Écart : ${round3(curRevenue - targetRevenue)} DT`,
      tone: (targetAchievementRate ?? 0) >= 100 ? "green" : "amber",
      tooltip: "Pourcentage de réalisation du chiffre d'affaires par rapport à l'objectif",
      formula: "(CA Réalisé / Objectif) × 100",
    },
  }

  return {
    asOf,
    period,
    range,
    previousRange,
    filters,
    kpis,
    monthlyTrend,
    agenciesPerformance,
    inventoryAgingSummary: {
      active: round3(stockAging.active),
      watch: round3(stockAging.watch),
      dormant: round3(stockAging.dormant),
    },
    recentAnomalies: anomalies,
  }
}
