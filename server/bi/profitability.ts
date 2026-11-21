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
import type { BiUniversalFilters, ProfitabilityResponse } from "./types.js"

export function computeProfitability(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): ProfitabilityResponse {
  const { asOf, range, previousRange } = resolvePeriodDates(db, filters.period, filters.from, filters.to)
  const currentFilters: BiUniversalFilters = { ...filters, from: range.from, to: range.to }
  const prevFilters: BiUniversalFilters = previousRange ? { ...filters, from: previousRange.from, to: previousRange.to } : {}

  const inScope = db.scopeFilter(scope)

  // 1. Current Period Margin Totals
  const curClause = buildFilterClauses(db, scope, currentFilters, {
    agencyCol: "s.agency_id",
    dateCol: "s.invoice_date",
    customerCol: "s.customer_id",
    categoryCol: "p.category_id",
    productCol: "p.id",
    repCol: "s.representative_id",
  })

  const curTotals = db.one<{
    revenue: number
    cost: number
  }>(
    `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM sales_invoices s
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}`,
    ...curClause.params,
  )

  let prevTotals = { revenue: 0, cost: 0 }
  if (previousRange) {
    const prevClause = buildFilterClauses(db, scope, prevFilters, {
      agencyCol: "s.agency_id",
      dateCol: "s.invoice_date",
      customerCol: "s.customer_id",
      categoryCol: "p.category_id",
      productCol: "p.id",
      repCol: "s.representative_id",
    })
    prevTotals = db.one<{ revenue: number; cost: number }>(
      `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
              coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
         FROM sales_invoices s
         JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
         JOIN products p ON p.id = l.product_id
        WHERE s.status = 'posted' AND ${prevClause.whereClause}`,
      ...prevClause.params,
    )
  }

  const curRevenue = round3(curTotals.revenue)
  const curCost = round3(curTotals.cost)
  const curMargin = round3(curRevenue - curCost)

  const prevRevenue = previousRange ? round3(prevTotals.revenue) : 0
  const prevCost = previousRange ? round3(prevTotals.cost) : 0
  const prevMargin = previousRange ? round3(prevRevenue - prevCost) : 0

  const curMarkupRate = safePct(curMargin, curRevenue)
  const prevMarkupRate = prevRevenue > 0 ? safePct(prevMargin, prevRevenue) : null
  const curMarginRate = safePct(curMargin, curCost)

  // 2. Deterministic 4-Factor Waterfall Decomposition
  // Price, Purchase Cost, Commercial Discounts, Mix & Volume
  type ProductAgg = {
    productId: string
    qty: number
    gross: number
    revenue: number
    cost: number
  }

  const getProductAggs = (from: string, to: string) => {
    const filterCopy = { ...filters, from, to }
    const clause = buildFilterClauses(db, scope, filterCopy, {
      agencyCol: "s.agency_id",
      dateCol: "s.invoice_date",
      customerCol: "s.customer_id",
      categoryCol: "p.category_id",
      productCol: "p.id",
      repCol: "s.representative_id",
    })
    return db.all<ProductAgg>(
      `SELECT p.id productId,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.quantity ELSE l.quantity END) qty,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -1 ELSE 1 END * l.quantity * l.unit_price) gross,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END) revenue,
              sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END) cost
         FROM sales_invoice_lines l
         JOIN sales_invoices s ON s.id = l.sales_invoice_id
         JOIN products p ON p.id = l.product_id
        WHERE s.status = 'posted' AND ${clause.whereClause}
        GROUP BY p.id`,
      ...clause.params,
    )
  }

  const curProducts = getProductAggs(range.from, range.to)
  const prevProductsMap = new Map(
    previousRange ? getProductAggs(previousRange.from, previousRange.to).map((p) => [p.productId, p]) : [],
  )

  let priceEffect = 0
  let costEffect = 0
  let discountEffect = 0

  for (const cp of curProducts) {
    const pp = prevProductsMap.get(cp.productId)
    if (!pp || !pp.qty || !cp.qty) continue
    const curUnitGross = cp.gross / cp.qty
    const prevUnitGross = pp.gross / pp.qty
    const curUnitCost = cp.cost / cp.qty
    const prevUnitCost = pp.cost / pp.qty
    const curUnitDiscount = (cp.gross - cp.revenue) / cp.qty
    const prevUnitDiscount = (pp.gross - pp.revenue) / pp.qty

    priceEffect += cp.qty * (curUnitGross - prevUnitGross)
    costEffect -= cp.qty * (curUnitCost - prevUnitCost)
    discountEffect -= cp.qty * (curUnitDiscount - prevUnitDiscount)
  }

  const totalGap = round3(curMargin - prevMargin)
  const roundPrice = round3(priceEffect)
  const roundCost = round3(costEffect)
  const roundDiscount = round3(discountEffect)
  const mixVolumeEffect = round3(totalGap - (roundPrice + roundCost + roundDiscount))

  // 3. Negative Margin Sales Detection
  const negativeSales = db.all<{
    invoiceNumber: string
    date: string
    customer: string
    product: string
    quantity: number
    unitPrice: number
    unitCost: number
    lineHt: number
    lineCost: number
  }>(
    `SELECT s.number invoiceNumber, s.invoice_date date, c.name customer,
            p.name product, l.quantity, l.unit_price unitPrice, l.unit_cost unitCost,
            l.line_ht lineHt, l.line_cost lineCost
       FROM sales_invoice_lines l
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
       JOIN customers c ON c.id = s.customer_id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND s.doc_type = 'invoice'
        AND l.line_ht < l.line_cost
        AND ${curClause.whereClause}
      ORDER BY (l.line_cost - l.line_ht) DESC LIMIT 25`,
    ...curClause.params,
  ).map((r) => ({
    invoiceNumber: r.invoiceNumber,
    date: r.date,
    customer: r.customer,
    product: r.product,
    quantity: r.quantity,
    unitPrice: round3(r.unitPrice),
    unitCost: round3(r.unitCost),
    lossAmount: round3(r.lineCost - r.lineHt),
  }))

  const negativeMarginLoss = negativeSales.reduce((sum, item) => sum + item.lossAmount, 0)

  // 4. Margin by Category (with N-1 comparison)
  const marginByCategory = db.all<{
    id: string
    name: string
    revenue: number
    cost: number
    prevRevenue: number
    prevCost: number
  }>(
    `SELECT pc.id, pc.name,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END END), 0) revenue,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END END), 0) cost,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END END), 0) prevRevenue,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END END), 0) prevCost
       FROM product_categories pc
       JOIN products p ON p.category_id = pc.id
       JOIN sales_invoice_lines l ON l.product_id = p.id
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
      WHERE s.status = 'posted' AND ${inScope("s.agency_id")}
      GROUP BY pc.id ORDER BY revenue DESC`,
    range.from,
    range.to,
    range.from,
    range.to,
    previousRange?.from ?? "",
    previousRange?.to ?? "",
    previousRange?.from ?? "",
    previousRange?.to ?? "",
  ).map((c) => {
    const rev = round3(c.revenue)
    const cost = round3(c.cost)
    const m = round3(rev - cost)
    const pRev = round3(c.prevRevenue)
    const pCost = round3(c.prevCost)
    const pM = round3(pRev - pCost)
    const curRate = safePct(m, rev)
    const prevRate = pRev > 0 ? safePct(pM, pRev) : null
    return {
      id: c.id,
      name: c.name,
      revenue: rev,
      cost,
      margin: m,
      markupRate: curRate,
      previousMarkupRate: prevRate,
      deltaPts: curRate !== null && prevRate !== null ? round1(curRate - prevRate) : null,
    }
  })

  // 5. Margin by Customer
  const marginByCustomer = db.all<{
    id: string
    name: string
    revenue: number
    cost: number
  }>(
    `SELECT c.id, c.name,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) revenue,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM customers c
       JOIN sales_invoices s ON s.customer_id = c.id
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
       JOIN products p ON p.id = l.product_id
      WHERE s.status = 'posted' AND ${curClause.whereClause}
      GROUP BY c.id ORDER BY (revenue - cost) DESC LIMIT 20`,
    ...curClause.params,
  ).map((c) => {
    const rev = round3(c.revenue)
    const cost = round3(c.cost)
    const m = round3(rev - cost)
    return {
      id: c.id,
      name: c.name,
      revenue: rev,
      cost,
      margin: m,
      markupRate: safePct(m, rev),
    }
  })

  return {
    asOf,
    range,
    previousRange,
    kpis: {
      grossMargin: curMargin,
      marginGrowthPts: curMarkupRate !== null && prevMarkupRate !== null ? round1(curMarkupRate - prevMarkupRate) : null,
      markupRate: curMarkupRate,
      marginRate: curMarginRate,
      negativeMarginLoss: round3(negativeMarginLoss),
      negativeMarginCount: negativeSales.length,
    },
    waterfallBridge: {
      previousMargin: prevMargin,
      currentMargin: curMargin,
      gap: totalGap,
      factors: [
        {
          id: "cost",
          label: "Impact Coût d'achat",
          impact: roundCost,
          description: roundCost < 0 ? "Hausse des prix d'achat fournisseurs réduisant la marge" : "Économies réalisées sur les coûts d'achat",
        },
        {
          id: "discount",
          label: "Impact Remises commerciales",
          impact: roundDiscount,
          description: roundDiscount < 0 ? "Remises plus généreuses accordées aux clients" : "Meilleure discipline sur les remises",
        },
        {
          id: "price",
          label: "Impact Prix de vente",
          impact: roundPrice,
          description: roundPrice >= 0 ? "Hausses tarifaires appliquées avec succès" : "Baisse des prix de vente unitaires",
        },
        {
          id: "volume_mix",
          label: "Effet Mix produits & Volume",
          impact: mixVolumeEffect,
          description: "Variation du volume global et composition du panier d'articles vendus",
        },
      ],
    },
    marginByCategory,
    marginByCustomer,
    negativeMarginSales: negativeSales,
  }
}
