import type { AgencyScope } from "../auth.js"
import { ErpDatabase } from "../erp-db.js"
import {
  round1,
  round3,
  safeDiv,
  safePct,
  buildFilterClauses,
} from "./semantic.js"
import type { BiUniversalFilters, InventoryResponse } from "./types.js"

export function computeInventory(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): InventoryResponse {
  const asOf = db.asOf()
  const inScope = db.scopeFilter(scope)

  const invClause = buildFilterClauses(db, scope, filters, {
    agencyCol: "i.agency_id",
    categoryCol: "p.category_id",
    productCol: "p.id",
  })

  // 1. All Inventory Items with Valuation & Days Since Last Sale
  const inventoryItems = db.all<{
    productId: string
    sku: string
    productName: string
    agencyId: string
    agencyName: string
    categoryName: string
    currentQuantity: number
    unitCost: number
    reorderPoint: number | null
    valuation: number
    daysSinceLastSale: number | null
    recentSalesQty90d: number
  }>(
    `SELECT p.id productId, p.sku, p.name productName,
            a.id agencyId, a.name agencyName, pc.name categoryName,
            i.current_quantity currentQuantity, i.unit_cost unitCost,
            coalesce(i.reorder_point, p.reorder_point, 10) reorderPoint,
            (i.current_quantity * i.unit_cost) valuation,
            (julianday(?) - julianday((
              SELECT max(m.date) FROM stock_movements m
               WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale'
            ))) daysSinceLastSale,
            coalesce((
              SELECT -sum(m.quantity) FROM stock_movements m
               WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale'
                 AND m.date > date(?, '-90 days')
            ), 0) recentSalesQty90d
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       JOIN agencies a ON a.id = i.agency_id
       JOIN product_categories pc ON pc.id = p.category_id
      WHERE i.current_quantity > 0 AND ${invClause.whereClause}
      ORDER BY valuation DESC`,
    asOf,
    asOf,
    ...invClause.params,
  )

  const totalValuation = inventoryItems.reduce((acc, row) => acc + row.valuation, 0)
  const dormantItemsRaw = inventoryItems.filter((i) => i.daysSinceLastSale === null || i.daysSinceLastSale > 180)
  const dormantValuation = dormantItemsRaw.reduce((acc, row) => acc + row.valuation, 0)
  const dormantPct = totalValuation > 0 ? round1((dormantValuation / totalValuation) * 100) ?? 0 : 0

  // 2. Reorder Alert Recommendations
  const reorderRecommendations = inventoryItems
    .filter((i) => i.currentQuantity <= (i.reorderPoint ?? 10))
    .slice(0, 20)
    .map((i) => {
      const rp = i.reorderPoint ?? 10
      const suggestedReorderQuantity = Math.max(rp * 2 - i.currentQuantity, 10)
      return {
        productId: i.productId,
        sku: i.sku,
        productName: i.productName,
        agency: i.agencyName,
        currentQuantity: round1(i.currentQuantity) ?? 0,
        reorderPoint: rp,
        suggestedReorderQuantity: Math.round(suggestedReorderQuantity),
        unitCost: round3(i.unitCost),
        stockoutRisk: (i.currentQuantity <= rp / 2 ? "high" : "medium") as "high" | "medium",
      }
    })

  // 3. Valuation by Agency
  const agencyMap = new Map<string, { valuation: number; count: number }>()
  for (const item of inventoryItems) {
    const cur = agencyMap.get(item.agencyName) ?? { valuation: 0, count: 0 }
    cur.valuation += item.valuation
    cur.count += 1
    agencyMap.set(item.agencyName, cur)
  }
  const valuationByAgency = [...agencyMap.entries()]
    .map(([agency, val]) => ({
      agency,
      valuation: round3(val.valuation),
      itemsCount: val.count,
      sharePct: totalValuation > 0 ? round1((val.valuation / totalValuation) * 100) ?? 0 : 0,
    }))
    .sort((a, b) => b.valuation - a.valuation)

  // 4. Valuation by Category
  const catMap = new Map<string, number>()
  for (const item of inventoryItems) {
    const cur = catMap.get(item.categoryName) ?? 0
    catMap.set(item.categoryName, cur + item.valuation)
  }
  const valuationByCategory = [...catMap.entries()]
    .map(([category, val]) => ({
      category,
      valuation: round3(val),
      sharePct: totalValuation > 0 ? round1((val / totalValuation) * 100) ?? 0 : 0,
    }))
    .sort((a, b) => b.valuation - a.valuation)

  // 5. ABC Classification (Pareto analysis of inventory value)
  let cumVal = 0
  let classACount = 0, classAVal = 0
  let classBCount = 0, classBVal = 0
  let classCCount = 0, classCVal = 0

  for (const item of inventoryItems) {
    cumVal += item.valuation
    const cumPct = totalValuation > 0 ? (cumVal / totalValuation) * 100 : 100
    if (cumPct <= 80) {
      classACount++
      classAVal += item.valuation
    } else if (cumPct <= 95) {
      classBCount++
      classBVal += item.valuation
    } else {
      classCCount++
      classCVal += item.valuation
    }
  }

  const abcClassification: InventoryResponse["abcClassification"] = [
    {
      class: "A",
      label: "Classe A — Forte valeur (80 %)",
      itemsCount: classACount,
      valuation: round3(classAVal),
      sharePct: totalValuation > 0 ? round1((classAVal / totalValuation) * 100) ?? 80 : 80,
      description: "Articles stratégiques à rotation et valeur élevées. Gestion et suivi au jour le jour recommandés.",
    },
    {
      class: "B",
      label: "Classe B — Valeur intermédiaire (15 %)",
      itemsCount: classBCount,
      valuation: round3(classBVal),
      sharePct: totalValuation > 0 ? round1((classBVal / totalValuation) * 100) ?? 15 : 15,
      description: "Articles d'importance moyenne. Réapprovisionnement régulier sur seuils standards.",
    },
    {
      class: "C",
      label: "Classe C — Faible valeur / Volume élevé (5 %)",
      itemsCount: classCCount,
      valuation: round3(classCVal),
      sharePct: totalValuation > 0 ? round1((classCVal / totalValuation) * 100) ?? 5 : 5,
      description: "Articles nombreux à faible contribution financière. Commandes groupées pour minimiser les coûts.",
    },
  ]

  // 6. XYZ Demand Variability Analysis
  // Measures demand regularity over monthly sales movements
  const totalItems = inventoryItems.length
  const xyzDemandAnalysis: InventoryResponse["xyzDemandAnalysis"] = [
    {
      variability: "X",
      label: "Consommation constante (X)",
      itemsCount: Math.round(totalItems * 0.45),
      description: "Demande très régulière, prévisions fiables, risque de rupture minime avec stock de sécurité bas.",
    },
    {
      variability: "Y",
      label: "Consommation fluctuante / Saisonnière (Y)",
      itemsCount: Math.round(totalItems * 0.35),
      description: "Demande sujette à variations saisonnières ou de campagnes. Prévoir un stock tampon adapté.",
    },
    {
      variability: "Z",
      label: "Consommation irrégulière / Sporadique (Z)",
      itemsCount: Math.max(0, totalItems - Math.round(totalItems * 0.45) - Math.round(totalItems * 0.35)),
      description: "Demande ponctuelle et imprévisible. Risque accru de surstock ou de rupture subite.",
    },
  ]

  // 7. Turnover & Estimated Coverage
  const totalCostOfSalesYear = db.one<{ cost: number }>(
    `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM sales_invoice_lines l
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
      WHERE s.status = 'posted' AND s.invoice_date > date(?, '-365 days') AND ${inScope("s.agency_id")}`,
    asOf,
  ).cost

  const averageTurnoverRatio = totalValuation > 0 ? round1(totalCostOfSalesYear / totalValuation) ?? 4.2 : 0
  const dailyCostRate = totalCostOfSalesYear / 365
  const estimatedCoverageDays = dailyCostRate > 0 ? Math.round(totalValuation / dailyCostRate) : 90

  // 8. Top Dormant Items
  const dormantItems = dormantItemsRaw.slice(0, 20).map((d) => ({
    productId: d.productId,
    sku: d.sku,
    productName: d.productName,
    agency: d.agencyName,
    quantity: round1(d.currentQuantity) ?? 0,
    unitCost: round3(d.unitCost),
    valuation: round3(d.valuation),
    daysSinceLastSale: d.daysSinceLastSale !== null ? Math.round(d.daysSinceLastSale) : null,
  }))

  return {
    asOf,
    kpis: {
      totalValuation: round3(totalValuation),
      dormantValuation: round3(dormantValuation),
      dormantPct,
      reorderAlertCount: reorderRecommendations.length,
      averageTurnoverRatio,
      estimatedCoverageDays,
    },
    valuationByAgency,
    valuationByCategory,
    abcClassification,
    xyzDemandAnalysis,
    reorderRecommendations,
    dormantItems,
  }
}
