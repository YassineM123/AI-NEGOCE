import type { AgencyScope } from "../auth.js"
import { analyzeCustomerConcentration } from "./decision-support.js"
import type { Dataset } from "../services.js"
import type { Sale } from "../data.js"
import {matchesReportPeriod,reportEnd,type ReportPeriod} from "./common.js"

/**
 * Revenue Growth Agent — deterministic, read-only pilot (REV-02/03/04/29/32/39).
 * The output is a ranked investigation queue, NOT a trained churn probability.
 * All figures are derived from posted sales lines with signed credit notes.
 */
export type RevenueAgentInput = {
  scope: AgencyScope
  dataset: Dataset
  period?:ReportPeriod
  windowDays?: number
  dormantDays?: number
  limit?: number
}

type CustomerState = "growing" | "declining" | "dormant" | "new"
type CustomerAccumulator = {
  id: string
  name: string
  agency: string
  representative: string
  current: Sale[]
  previous: Sale[]
  history: Sale[]
  lastPurchase: string | null
}

const millimes = (value: number) => Math.round(value * 1000)
const tnd = (value: number) => value / 1000
const total = (items: Sale[], field: "revenue" | "cost") =>
  items.reduce((sum, row) => sum + millimes(Number(row[field]) || 0), 0)

const shiftDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const ageDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

function margin(items: Sale[]) {
  if (!items.length || items.some((row) => row.cost === null || row.cost === undefined))
    return { amount: null, ratePercent: null, coverage: items.length ? "partial_or_missing" : "no_sales" }
  const revenue = total(items, "revenue")
  const value = revenue - total(items, "cost")
  return {
    amount: tnd(value),
    ratePercent: revenue > 0 ? Math.round((value / revenue) * 10_000) / 100 : null,
    coverage: "complete",
  }
}

export function analyzeRevenueGrowth(input: RevenueAgentInput) {
  const windowDays = input.windowDays ?? 90
  const dormantDays = input.dormantDays ?? 90
  const limit = input.limit ?? 20
  if (!Number.isInteger(windowDays) || windowDays < 30 || windowDays > 365)
    throw new Error("windowDays must be an integer between 30 and 365")
  if (!Number.isInteger(dormantDays) || dormantDays < 30 || dormantDays > 365)
    throw new Error("dormantDays must be an integer between 30 and 365")
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be an integer between 1 and 100")

  const asOf = reportEnd(input.dataset.metadata.asOf,input.period)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)))
    throw new Error("A valid dataset asOf date is required")
  const currentFrom = input.period?.from && input.period.from>shiftDays(asOf,1-windowDays)?input.period.from:shiftDays(asOf,1-windowDays)
  const previousTo = shiftDays(currentFrom, -1)
  const previousFrom = input.period?.from && input.period.from>shiftDays(currentFrom,-windowDays)?input.period.from:shiftDays(currentFrom,-windowDays)

  const allowed = (agency: string) => input.scope === "*" || input.scope.includes(agency)
  const customers = new Map<string, CustomerAccumulator>()
  let scopedPostedLines = 0
  for (const row of input.dataset.sales) {
    if (!allowed(row.agency) || !matchesReportPeriod(row.date,input.period) || (row.status ?? "posted") !== "posted" || row.date > asOf) continue
    scopedPostedLines++
    // Use stable IDs; in their absence names are not joined across agencies.
    const id = row.customerId || `name:${row.agency}:${row.customer}`
    const key = `${row.agency}\u0000${id}`
    let customer = customers.get(key)
    if (!customer) {
      customer = {
        id, name: row.customer, agency: row.agency, representative: row.representative,
        current: [], previous: [], history: [], lastPurchase: null,
      }
      customers.set(key, customer)
    }
    customer.history.push(row)
    if (row.date >= currentFrom) customer.current.push(row)
    else if (row.date >= previousFrom && row.date <= previousTo) customer.previous.push(row)
    if (row.revenue > 0 && (!customer.lastPurchase || customer.lastPurchase < row.date))
      customer.lastPurchase = row.date
  }

  const opportunities = []
  for (const customer of customers.values()) {
    const currentM = total(customer.current, "revenue")
    const previousM = total(customer.previous, "revenue")
    const lastPurchaseDays = customer.lastPurchase ? ageDays(customer.lastPurchase, asOf) : null
    const isDormant = currentM <= 0 && lastPurchaseDays !== null && lastPurchaseDays >= dormantDays
    let state: CustomerState | null = null
    if (isDormant) state = "dormant"
    else if (currentM > 0 && previousM <= 0 && previousFrom<currentFrom) state = "new"
    else if (previousM > 0 && currentM > previousM) state = "growing"
    else if (previousM > 0 && currentM < previousM) state = "declining"
    if (!state) continue

    const currentMargin = margin(customer.current)
    const historicValue = Math.max(0, currentM, previousM)
    // Transparent priority heuristic. NEVER label it a calibrated probability.
    const stateWeight = { growing: 45, declining: 40, dormant: 35, new: 20 }[state]
    const valueWeight = Math.min(35, Math.round(Math.log10(1 + tnd(historicValue)) * 8))
    const recencyWeight = lastPurchaseDays !== null && lastPurchaseDays <= 30 ? 15 : 5
    const priorityScore = Math.min(100, stateWeight + valueWeight + recencyWeight)
    const deltaPct = previousM > 0 ? Math.round(((currentM - previousM) / previousM) * 10_000) / 100 : null
    const type = state === "growing" ? "review_cross_sell"
      : state === "new" ? "review_onboarding"
      : "prepare_reactivation_call"
    const reason = state === "growing" ? "CA en hausse sur deux fenêtres comparables"
      : state === "declining" ? "CA en baisse sur deux fenêtres comparables"
      : state === "dormant" ? "Aucun achat récent selon le seuil de dormance"
      : "Achat sur la période courante, sans CA positif sur la fenêtre précédente"
    const documents = [...new Set(customer.history.map((r) => r.invoiceId))]
    const warnings = [
      ...(currentMargin.coverage !== "complete" ? ["Marge indisponible ou incomplète : vérifier les coûts historiques"] : []),
      "Stock, encours, litiges et conditions commerciales non vérifiés",
      ...(customer.id.startsWith("name:") ? ["Identifiant client absent : rapprochement fondé sur le nom et l'agence"] : []),
    ]
    opportunities.push({
      customerId: customer.id,
      customerName: customer.name,
      agency: customer.agency,
      representative: customer.representative,
      state,
      reason,
      priorityScore,
      priorityMethod: "heuristic_v1_not_a_probability",
      metrics: {
        currentRevenueTnd: tnd(currentM),
        previousRevenueTnd: tnd(previousM),
        growthPercent: deltaPct,
        currentMargin,
        lastPurchase: customer.lastPurchase,
        daysSinceLastPurchase: lastPurchaseDays,
      },
      proposedAction: { type, status: "draft_only" as const, requiresHumanApproval: true },
      evidence: { invoiceCount: documents.length, invoiceIds: documents.slice(0, 20) },
      warnings,
    })
  }

  const ordered = opportunities.sort((a, b) =>
    b.priorityScore - a.priorityScore ||
    b.metrics.currentRevenueTnd - a.metrics.currentRevenueTnd ||
    a.customerId.localeCompare(b.customerId))
  return {
    agent: "revenue_growth",
    status: scopedPostedLines ? "ok" : "no_data",
    executionMode: "read_only" as const,
    currency: "TND",
    snapshot: {
      asOf:input.dataset.metadata.asOf,
      analysisEnd:asOf,
      source: input.dataset.metadata.source,
      dataUpdatedAt: input.dataset.metadata.lastUpdated,
      current: { from: currentFrom, to: asOf },
      previous: { from: previousFrom, to: previousTo },
      scope: input.scope,
      period:{from:input.period?.from??null,to:input.period?.to??null},
    },
    analysis: {
      customersAnalyzed: customers.size,
      postedLinesAnalyzed: scopedPostedLines,
      opportunitiesFound: ordered.length,
      returned: Math.min(ordered.length, limit),
    },
    opportunities: ordered.slice(0, limit),
    decisionSupport:{portfolio:analyzeCustomerConcentration(input.dataset,input.scope,input.period)},
    warnings: [
      "Priorités heuristiques non probabilistes : aucune prédiction ML n'a été utilisée",
      "Les actions proposées ne sont pas exécutées dans l'ERP",
      ...(scopedPostedLines ? [] : ["Aucune vente exploitable dans le périmètre autorisé et la période sélectionnée"]),
    ],
  }
}
