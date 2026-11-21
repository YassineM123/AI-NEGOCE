import type { AgencyScope } from "../auth.js"
import type { Dataset } from "../services.js"
import type { Sale, Receivable, InventoryItem } from "../data.js"

export type ReportPeriod={from?:string;to?:string}
export const matchesReportPeriod=(date:string,period:ReportPeriod={})=>
  (!period.from||date>=period.from)&&(!period.to||date<=period.to)
export const periodContainsSnapshot=(asOf:string,period:ReportPeriod={})=>
  matchesReportPeriod(asOf,period)
export const reportEnd=(asOf:string,period:ReportPeriod={})=>
  period.to&&period.to<asOf?period.to:asOf
export type AgentDomain = "financial_strategy" | "supply_chain_intelligence" | "business_strategy"
export type AgentPriority = "high" | "medium" | "low"
export type Evidence = { type: "invoice" | "stock_position" | "receivable"; id: string; agency: string }
export type AgentFinding = {
  id: string
  title: string
  priority: AgentPriority
  explanation: string
  evidence: Evidence[]
  action: { type: string; status: "draft_only"; requiresHumanApproval: true }
}
export type AgentSnapshot = {
  asOf: string
  source: string
  lastUpdated: string
  scope: AgencyScope
  currency: "TND"
  period: {from:string|null;to:string|null}
}
export type AgentReport = {
  agent: AgentDomain
  status: "ok" | "no_data"
  executionMode: "read_only"
  snapshot: AgentSnapshot
  metrics: Record<string, number | null>
  findings: AgentFinding[]
  scenarios: Array<{ id: string; label: string; assumption: string; valueTnd: number | null }>
  decisionSupport?: Record<string,unknown>
  warnings: string[]
}
export const inScope = (agency: string, scope: AgencyScope) =>
  scope === "*" || scope.includes(agency)

export function snapshot(data: Dataset, scope: AgencyScope, period:ReportPeriod={}): AgentSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.metadata.asOf)) throw new Error("Missing dataset asOf date")
  return {
    asOf: data.metadata.asOf,
    source: data.metadata.source,
    lastUpdated: data.metadata.lastUpdated,
    scope,
    currency: "TND",
    period:{from:period.from??null,to:period.to??null},
  }
}
export function salesInScope(data: Dataset, scope: AgencyScope, period:ReportPeriod={}): Sale[] {
  const asOf = data.metadata.asOf
  return data.sales.filter((row) =>
    inScope(row.agency, scope) && row.date <= asOf && matchesReportPeriod(row.date,period) && (row.status ?? "posted") === "posted"
  )
}
export function receivablesInScope(data: Dataset, scope: AgencyScope, period:ReportPeriod={}): Receivable[] {
  const asOf = data.metadata.asOf
  return data.receivables.filter((row) =>
    inScope(row.agency, scope) && row.date <= asOf && matchesReportPeriod(row.date,period) && Number.isFinite(row.outstanding) && row.outstanding > 0
  )
}
export function inventoryInScope(data: Dataset, scope: AgencyScope, period:ReportPeriod={}): InventoryItem[] {
  if(!periodContainsSnapshot(data.metadata.asOf,period))return []
  return data.inventory.filter((row) => inScope(row.agency, scope))
}
export const amount = (n: number): number => Math.round(n * 1000) / 1000
export const sumMoney = (values: number[]): number =>
  Math.round(values.reduce((acc, val) => acc + Math.round(val * 1000), 0)) / 1000
export const percent = (num: number, den: number): number | null =>
  den > 0 ? Math.round(num / den * 10000) / 100 : null
export const daysBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000)
export function ensureLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be from 1 to 100")
}
export function finding(
  id: string, title: string, priority: AgentPriority, explanation: string,
  type: string, evidence: Evidence[],
): AgentFinding {
  return {
    id, title, priority, explanation, evidence: evidence.slice(0, 20),
    action: { type, status: "draft_only", requiresHumanApproval: true },
  }
}
