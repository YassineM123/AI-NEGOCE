import type { AgencyScope } from "../auth.js"
import { ErpDatabase } from "../erp-db.js"
import { computeExecutiveCockpit } from "./cockpit.js"
import { computeSalesIntelligence } from "./sales.js"
import { computeProfitability } from "./profitability.js"
import { computePurchases } from "./purchases.js"
import { computeInventory } from "./inventory.js"
import { computeFinance } from "./finance.js"
import type { BiUniversalFilters } from "./types.js"

export interface ExportReportOptions {
  module?: "cockpit" | "sales" | "profitability" | "purchases" | "inventory" | "finance" | "all"
  format?: "csv" | "json"
}

export function generateExportReport(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
  options: ExportReportOptions = {},
) {
  const asOf = db.asOf()
  const mod = options.module ?? "all"

  if (options.format === "json") {
    return {
      generatedAt: new Date().toISOString(),
      asOf,
      scope,
      filters,
      cockpit: mod === "all" || mod === "cockpit" ? computeExecutiveCockpit(db, scope, filters) : undefined,
      sales: mod === "all" || mod === "sales" ? computeSalesIntelligence(db, scope, filters) : undefined,
      profitability: mod === "all" || mod === "profitability" ? computeProfitability(db, scope, filters) : undefined,
      purchases: mod === "all" || mod === "purchases" ? computePurchases(db, scope, filters) : undefined,
      inventory: mod === "all" || mod === "inventory" ? computeInventory(db, scope, filters) : undefined,
      finance: mod === "all" || mod === "finance" ? computeFinance(db, scope, filters) : undefined,
    }
  }

  // Generate structured CSV with UTF-8 BOM and standard French corporate delimiter (;)
  const lines: string[] = []
  lines.push("AI-NÉGOCE / NEXORA — RAPPORT DE GESTION BI 360 ENTERPRISE")
  lines.push(`Date d'arrêté;${asOf}`)
  lines.push(`Généré le;${new Date().toISOString()}`)
  lines.push(`Périmètre agence;${filters.agency || (scope === "*" ? "Toutes agences" : scope.join(", "))}`)
  lines.push(`Période;${filters.period ?? "Année courante"}`)
  lines.push("")

  // 1. Cockpit Section
  const cockpit = computeExecutiveCockpit(db, scope, filters)
  lines.push("=== VUE EXÉCUTIVE & KPIS CLÉS ===")
  lines.push("Indicateur;Valeur;Unité;Variation N-1;Formule de calcul")
  for (const kpi of Object.values(cockpit.kpis)) {
    lines.push(
      `"${kpi.label}";"${kpi.value}";"${kpi.unit}";"${kpi.deltaPct !== null ? kpi.deltaPct + ' %' : (kpi.deltaPts !== null ? kpi.deltaPts + ' pts' : 'N/A')}";"${kpi.formula}"`,
    )
  }
  lines.push("")

  // 2. Performance Agences
  lines.push("=== PERFORMANCE PAR AGENCE ===")
  lines.push("Agence;CA HT (DT);Marge brute (DT);Taux de marque (%);Part du CA (%)")
  for (const a of cockpit.agenciesPerformance) {
    lines.push(`"${a.agency}";"${a.revenue}";"${a.margin}";"${a.markupRate ?? ''}";"${a.sharePct}"`)
  }
  lines.push("")

  // 3. Top Clients (if requested)
  if (mod === "all" || mod === "sales") {
    const sales = computeSalesIntelligence(db, scope, filters)
    lines.push("=== TOP 20 CLIENTS ===")
    lines.push("Client;Agence;Segment;CA HT (DT);Part (%);Factures;Taux de marque (%)")
    for (const c of sales.topCustomers) {
      lines.push(`"${c.name}";"${c.agency}";"${c.segment}";"${c.revenue}";"${c.sharePct}";"${c.invoicesCount}";"${c.marginPct ?? ''}"`)
    }
    lines.push("")
  }

  // 4. Top Fournisseurs (if requested)
  if (mod === "all" || mod === "purchases") {
    const purch = computePurchases(db, scope, filters)
    lines.push("=== TOP FOURNISSEURS ===")
    lines.push("Fournisseur;Ville;Achats HT (DT);Part (%);Factures;Délai contractuel (j)")
    for (const s of purch.topSuppliers) {
      lines.push(`"${s.name}";"${s.city}";"${s.totalPurchasesHt}";"${s.sharePct}";"${s.invoicesCount}";"${s.paymentTermsDays}"`)
    }
    lines.push("")
  }

  // 5. Balance Âgée Clients (if requested)
  if (mod === "all" || mod === "finance") {
    const fin = computeFinance(db, scope, filters)
    lines.push("=== BALANCE ÂGÉE CLIENTS ===")
    lines.push("Tranche d'ancienneté;Montant dû (DT);Nombre factures;Part (%)")
    for (const b of fin.agingBuckets) {
      lines.push(`"${b.label}";"${b.amount}";"${b.invoicesCount}";"${b.sharePct}"`)
    }
    lines.push("")
  }

  return lines.join("\r\n")
}
