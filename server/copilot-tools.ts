import type { AgencyScope } from "./auth.js"
import { ErpDatabase } from "./erp-db.js"
import type { Dataset } from "./services.js"
import { defaultDataset, filteredSales, overview } from "./services.js"
import { z } from "zod"

export type BusinessToolResult = {
  tool: string
  status: "ok" | "denied" | "unsupported" | "error"
  summary: string
  data: unknown
  table?: Record<string, unknown>[]
  sources: string[]
  explanation?: string
}

export type ToolContext = {
  scope: AgencyScope
  userRole?: string
  erpDb?: ErpDatabase | null
  dataset?: Dataset
}

const toM = (x: number) => Math.round(x * 1000)
const fromM = (m: number) => m / 1000
const tnd = (m: number) => fromM(m).toFixed(3)

function normalizeScope(scope: AgencyScope, requestedAgency?: string): AgencyScope {
  if (!requestedAgency || requestedAgency === "all" || requestedAgency === "*") {
    return scope
  }
  if (scope === "*") return [requestedAgency]
  if (scope.includes(requestedAgency)) return [requestedAgency]
  return [] // Out of scope
}

// 1. Tool: get_sales_summary
export const salesSummaryInputSchema = z.object({
  agency: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
export type SalesSummaryInput = z.infer<typeof salesSummaryInputSchema>

export function toolGetSalesSummary(input: SalesSummaryInput, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return {
      tool: "get_sales_summary",
      status: "denied",
      summary: `Accès refusé : l'agence demandée (${input.agency}) est hors de votre périmètre autorisé.`,
      data: null,
      sources: [],
    }
  }

  const ds = ctx.dataset ?? defaultDataset()
  const ov = overview({ agencies: activeScope, from: input.from, to: input.to }, ds)
  const rows = filteredSales({ agencies: activeScope, from: input.from, to: input.to }, ds)
  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId))]

  return {
    tool: "get_sales_summary",
    status: "ok",
    summary: `Chiffre d'affaires HT : ${tnd(toM(ov.revenue))} TND ; Marge brute : ${tnd(toM(ov.grossMargin))} TND (${ov.grossMarginPercent !== null ? ov.grossMarginPercent.toFixed(1) : "0.0"} %) sur ${invoiceIds.length} facture(s).`,
    data: {
      revenue: ov.revenue,
      cost: ov.cost,
      grossMargin: ov.grossMargin,
      grossMarginPercent: ov.grossMarginPercent,
      invoiceCount: invoiceIds.length,
      marginCoverage: ov.marginCoverage,
      asOf: ov.metadata.asOf,
      period: { from: input.from ?? "début", to: input.to ?? "fin" },
      agencies: activeScope === "*" ? "Toutes les agences" : activeScope,
    },
    sources: invoiceIds,
    explanation: `Calcul : CA HT = somme des lignes factures hors taxe (${tnd(toM(ov.revenue))} TND). Marge = CA HT - Coût de revient (${tnd(toM(ov.grossMargin))} TND). Taux de marge = ${ov.grossMarginPercent !== null ? ov.grossMarginPercent.toFixed(1) + " %" : "N/A"}.`,
  }
}

/** Read-only invoice listing. Rows are grouped server-side; the LLM never sees SQL. */
export function toolListSalesInvoices(input: SalesSummaryInput & { limit?: number }, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return { tool: "list_sales_invoices", status: "denied", summary: "Accès refusé à l'agence demandée.", data: null, sources: [] }
  }
  const ds = ctx.dataset ?? defaultDataset()
  const rows = filteredSales({ agencies: activeScope, from: input.from, to: input.to }, ds)
  const invoices = new Map<string, { invoiceId: string; date: string; customer: string; agency: string; totalHt: number }>()
  for (const row of rows) {
    const current = invoices.get(row.invoiceId) ?? {
      invoiceId: row.invoiceId,
      date: row.date,
      customer: row.customer,
      agency: row.agency,
      totalHt: 0,
    }
    current.totalHt += toM(row.revenue)
    invoices.set(row.invoiceId, current)
  }
  const all = [...invoices.values()]
    .map((invoice) => ({ ...invoice, totalHt: fromM(invoice.totalHt) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.invoiceId.localeCompare(b.invoiceId))
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const table = all.slice(0, limit)
  return {
    tool: "list_sales_invoices",
    status: "ok",
    summary: `${all.length} facture(s) de vente trouvée(s)${all.length > table.length ? ` ; ${table.length} affichée(s)` : ""}.`,
    data: { count: all.length, displayed: table.length },
    table,
    sources: all.map((invoice) => invoice.invoiceId),
    explanation: "Factures regroupées depuis les lignes de vente ERP, avec total HT calculé côté serveur.",
  }
}

// 2. Tool: get_margin_analysis
export const marginAnalysisInputSchema = z.object({
  agency: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().optional(),
})
export type MarginAnalysisInput = z.infer<typeof marginAnalysisInputSchema>

export function toolGetMarginAnalysis(input: MarginAnalysisInput, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return {
      tool: "get_margin_analysis",
      status: "denied",
      summary: `Accès refusé pour l'agence demandée : ${input.agency}.`,
      data: null,
      sources: [],
    }
  }

  const ds = ctx.dataset ?? defaultDataset()
  const rows = filteredSales({ agencies: activeScope, from: input.from, to: input.to }, ds)

  // Group by product category / family
  const families = new Map<string, { revenue: number; cost: number; records: string[] }>()
  for (const r of rows) {
    const f = r.family ?? "Autre"
    const current = families.get(f) ?? { revenue: 0, cost: 0, records: [] }
    current.revenue += toM(r.revenue)
    if (r.cost !== null && r.cost !== undefined) {
      current.cost += toM(r.cost)
    }
    current.records.push(r.invoiceId)
    families.set(f, current)
  }

  const table = [...families.entries()]
    .map(([family, stats]) => {
      const margin = stats.revenue - stats.cost
      const marginPct = stats.revenue > 0 ? (margin / stats.revenue) * 100 : 0
      return {
        category: family,
        revenue: fromM(stats.revenue),
        cost: fromM(stats.cost),
        margin: fromM(margin),
        marginPercent: Number(marginPct.toFixed(1)),
        recordsCount: new Set(stats.records).size,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId))]

  return {
    tool: "get_margin_analysis",
    status: "ok",
    summary: `Analyse de marge décomposée sur ${table.length} famille(s) de produits pour un total de ${invoiceIds.length} facture(s).`,
    data: { families: table },
    table,
    sources: invoiceIds,
    explanation: "Chaque famille présente le CA HT, le coût de revient, la marge dégagée en DT et le taux de marge en pourcentage.",
  }
}

// 3. Tool: get_customer_receivables
export const customerReceivablesInputSchema = z.object({
  agency: z.string().optional(),
  overdueOnly: z.boolean().optional(),
  minDaysOverdue: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().default(20),
})
export type CustomerReceivablesInput = z.input<typeof customerReceivablesInputSchema>

export function toolGetCustomerReceivables(input: CustomerReceivablesInput, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return {
      tool: "get_customer_receivables",
      status: "denied",
      summary: `Accès refusé aux créances pour l'agence : ${input.agency}.`,
      data: null,
      sources: [],
    }
  }

  const ds = ctx.dataset ?? defaultDataset()
  const today = ds.metadata.asOf ?? new Date().toISOString().slice(0, 10)
  const limit = input.limit ?? 20

  let list = ds.receivables.filter(
    (r) =>
      r.outstanding > 0 &&
      (!activeScope || activeScope === "*" || activeScope.includes(r.agency)),
  )

  if (input.overdueOnly) {
    list = list.filter((r) => r.dueDate < today)
  }

  const totalOutstanding = list.reduce((sum, r) => sum + toM(r.outstanding), 0)
  const overdueTotal = list
    .filter((r) => r.dueDate < today)
    .reduce((sum, r) => sum + toM(r.outstanding), 0)

  list.sort((a, b) => b.outstanding - a.outstanding || a.invoiceId.localeCompare(b.invoiceId))

  const table = list.slice(0, limit).map((r) => ({
    invoiceId: r.invoiceId,
    customer: r.customer,
    agency: r.agency,
    invoiceDate: r.date,
    dueDate: r.dueDate,
    outstanding: r.outstanding,
    isOverdue: r.dueDate < today,
  }))

  const sources = list.map((r) => r.invoiceId)

  return {
    tool: "get_customer_receivables",
    status: "ok",
    summary: `Créances clients : ${tnd(totalOutstanding)} TND sur ${list.length} facture(s), dont ${tnd(overdueTotal)} TND échus au ${today}.`,
    data: {
      totalOutstanding: fromM(totalOutstanding),
      overdueTotal: fromM(overdueTotal),
      count: list.length,
      asOf: today,
    },
    table,
    sources,
    explanation: `Créances clients actives = factures ouvertes non encore entièrement soldées. Part échue = factures dont la date d'échéance est antérieure au ${today}.`,
  }
}

// 4. Tool: get_supplier_purchases
export const supplierPurchasesInputSchema = z.object({
  agency: z.string().optional(),
  supplierName: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().positive().default(20),
})
export type SupplierPurchasesInput = z.input<typeof supplierPurchasesInputSchema>

export function toolGetSupplierPurchases(input: SupplierPurchasesInput, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return {
      tool: "get_supplier_purchases",
      status: "denied",
      summary: `Accès refusé pour les achats de l'agence : ${input.agency}.`,
      data: null,
      sources: [],
    }
  }

  if (ctx.erpDb) {
    const inScope = ctx.erpDb.scopeFilter(activeScope)
    const limit = input.limit ?? 20
    let sql = `
      SELECT f.id, f.supplier_invoice_number AS number, f.invoice_date AS date,
             p.name AS supplier, a.name AS agency, f.total_ht AS totalHt,
             f.total_ttc AS totalTtc, f.status
      FROM supplier_invoices f
      JOIN suppliers p ON p.id = f.supplier_id
      JOIN agencies a ON a.id = f.agency_id
      WHERE ${inScope("f.agency_id")}
    `
    const params: (string | number)[] = []
    if (input.from) {
      sql += " AND f.invoice_date >= ?"
      params.push(input.from)
    }
    if (input.to) {
      sql += " AND f.invoice_date <= ?"
      params.push(input.to)
    }
    if (input.supplierName) {
      sql += " AND p.name LIKE ?"
      params.push(`%${input.supplierName}%`)
    }
    sql += " ORDER BY f.invoice_date DESC LIMIT ?"
    params.push(limit)

    const rows = ctx.erpDb.all<{
      id: string
      number: string
      date: string
      supplier: string
      agency: string
      totalHt: number
      totalTtc: number
      status: string
    }>(sql, ...params)

    const totalHt = rows.reduce((acc, r) => acc + (r.totalHt ?? 0), 0)
    const sources = rows.map((r) => r.number || r.id)

    return {
      tool: "get_supplier_purchases",
      status: "ok",
      summary: `Achats fournisseurs trouvés : ${rows.length} facture(s) pour un total HT de ${totalHt.toFixed(3)} TND.`,
      data: {
        totalHt,
        count: rows.length,
      },
      table: rows,
      sources,
      explanation: "Données issues des factures d'achat fournisseurs enregistrées dans l'ERP.",
    }
  }

  return {
    tool: "get_supplier_purchases",
    status: "unsupported",
    summary: "Le module d'achat détaillé nécessite la connexion à la base de données ERP active.",
    data: null,
    sources: [],
  }
}

// 5. Tool: get_slow_moving_inventory
export const slowMovingInventoryInputSchema = z.object({
  agency: z.string().optional(),
  daysThreshold: z.number().int().positive().default(90),
  limit: z.number().int().positive().default(20),
})
export type SlowMovingInventoryInput = z.input<typeof slowMovingInventoryInputSchema>

export function toolGetSlowMovingInventory(input: SlowMovingInventoryInput, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return {
      tool: "get_slow_moving_inventory",
      status: "denied",
      summary: `Accès refusé à l'inventaire pour l'agence : ${input.agency}.`,
      data: null,
      sources: [],
    }
  }

  const threshold = input.daysThreshold ?? 90
  const limit = input.limit ?? 20

  if (ctx.erpDb) {
    const asOf = ctx.erpDb.asOf()
    const inScope = ctx.erpDb.scopeFilter(activeScope)
    const sql = `
      SELECT p.sku, p.name AS product, a.name AS agency,
             i.current_quantity AS quantity, i.unit_cost AS unitCost,
             (i.current_quantity * i.unit_cost) AS stockValue,
             CAST(julianday(?) - julianday(COALESCE(
               (SELECT max(m.date) FROM stock_movements m WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale'),
               '2024-01-01'
             )) AS INTEGER) AS daysSinceLastSale
      FROM inventory i
      JOIN products p ON p.id = i.product_id
      JOIN agencies a ON a.id = i.agency_id
      WHERE i.current_quantity > 0 AND ${inScope("i.agency_id")}
      HAVING daysSinceLastSale >= ?
      ORDER BY stockValue DESC
      LIMIT ?
    `
    const rows = ctx.erpDb.all<{
      sku: string
      product: string
      agency: string
      quantity: number
      unitCost: number
      stockValue: number
      daysSinceLastSale: number
    }>(sql, asOf, threshold, limit)

    const totalValue = rows.reduce((sum, r) => sum + r.stockValue, 0)
    const sources = rows.map((r) => r.sku)

    return {
      tool: "get_slow_moving_inventory",
      status: "ok",
      summary: `${rows.length} article(s) en stock dormant (> ${threshold} jours sans vente), représentant ${totalValue.toFixed(3)} TND de valeur immobilisée.`,
      data: {
        itemCount: rows.length,
        immobilizedValue: totalValue,
        thresholdDays: threshold,
      },
      table: rows,
      sources,
      explanation: `Stock dormant : articles ayant un stock positif et dont la dernière sortie pour vente remonte à plus de ${threshold} jours par rapport à la date de référence (${asOf}).`,
    }
  }

  return {
    tool: "get_slow_moving_inventory",
    status: "unsupported",
    summary: "L'analyse du stock dormant nécessite la consultation des mouvements de stock de l'ERP.",
    data: null,
    sources: [],
  }
}

// 6. Tool: get_product_stock
export const productStockInputSchema = z.object({
  query: z.string().optional(),
  lowStockOnly: z.boolean().optional(),
  agency: z.string().optional(),
  limit: z.number().int().positive().default(25),
})
export type ProductStockInput = z.input<typeof productStockInputSchema>

export function toolGetProductStock(input: ProductStockInput, ctx: ToolContext): BusinessToolResult {
  const activeScope = normalizeScope(ctx.scope, input.agency)
  if (activeScope !== "*" && activeScope.length === 0) {
    return {
      tool: "get_product_stock",
      status: "denied",
      summary: `Accès refusé au stock pour l'agence : ${input.agency}.`,
      data: null,
      sources: [],
    }
  }

  const ds = ctx.dataset ?? defaultDataset()
  let items = ds.inventory.filter((i) => !activeScope || activeScope === "*" || activeScope.includes(i.agency))
  const limit = input.limit ?? 25

  if (input.lowStockOnly) {
    items = items.filter((i) => i.quantity <= i.reorderPoint)
  }
  if (input.query) {
    const q = input.query.toLowerCase().trim()
    items = items.filter((i) => i.product.toLowerCase().includes(q) || i.reference.toLowerCase().includes(q))
  }

  const table = items.slice(0, limit).map((i) => ({
    reference: i.reference,
    product: i.product,
    agency: i.agency,
    quantity: i.quantity,
    reorderPoint: i.reorderPoint,
    unitCost: i.unitCost,
    stockValue: fromM(i.quantity * toM(i.unitCost)),
    status: i.quantity <= i.reorderPoint ? "Réapprovisionnement requis" : "Normal",
  }))

  const sources = items.map((i) => i.reference)
  const totalStockValue = items.reduce((sum, i) => sum + i.quantity * toM(i.unitCost), 0)

  return {
    tool: "get_product_stock",
    status: "ok",
    summary: `${items.length} référence(s) trouvée(s) pour une valeur totale de ${tnd(totalStockValue)} TND.${input.lowStockOnly ? ` Dont ${items.length} produit(s) sous le seuil de réapprovisionnement.` : ""}`,
    data: {
      totalItems: items.length,
      totalStockValue: fromM(totalStockValue),
    },
    table,
    sources,
  }
}

// 7. Tool: compare_branches
export const compareBranchesInputSchema = z.object({
  metric: z.enum(["revenue", "margin", "receivables"]).default("revenue"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
export type CompareBranchesInput = z.input<typeof compareBranchesInputSchema>

export function toolCompareBranches(input: CompareBranchesInput, ctx: ToolContext): BusinessToolResult {
  const ds = ctx.dataset ?? defaultDataset()
  const rows = filteredSales({ agencies: ctx.scope, from: input.from, to: input.to }, ds)
  const metric = input.metric ?? "revenue"

  const agenciesMap = new Map<string, { revenue: number; cost: number; docs: Set<string> }>()
  for (const r of rows) {
    const cur = agenciesMap.get(r.agency) ?? { revenue: 0, cost: 0, docs: new Set() }
    cur.revenue += toM(r.revenue)
    if (r.cost !== null && r.cost !== undefined) cur.cost += toM(r.cost)
    cur.docs.add(r.invoiceId)
    agenciesMap.set(r.agency, cur)
  }

  const table = [...agenciesMap.entries()]
    .map(([agency, stats]) => {
      const margin = stats.revenue - stats.cost
      const marginPct = stats.revenue > 0 ? (margin / stats.revenue) * 100 : 0
      return {
        agency,
        revenue: fromM(stats.revenue),
        cost: fromM(stats.cost),
        margin: fromM(margin),
        marginPercent: Number(marginPct.toFixed(1)),
        documentsCount: stats.docs.size,
      }
    })
    .sort((a, b) => (input.metric === "margin" ? b.margin - a.margin : b.revenue - a.revenue))

  const lines = table.map(
    (r, i) => `${i + 1}. ${r.agency} — CA ${r.revenue.toFixed(3)} TND, marge ${r.margin.toFixed(3)} TND (${r.marginPercent} %)`,
  )
  const sources = [...new Set(rows.map((r) => r.invoiceId))]

  return {
    tool: "compare_branches",
    status: "ok",
    summary: `Comparaison sur ${sources.length} document(s), classée par ${input.metric === "margin" ? "marge" : "chiffre d'affaires"} : ${lines.join(" ; ")}.`,
    data: { ranking: table },
    table,
    sources,
  }
}
