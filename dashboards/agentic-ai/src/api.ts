import { platformContextSchema, analyticsOverviewSchema, type PlatformContext, type AnalyticsOverview } from "../../../shared/contracts/analytics-platform"

export type RevenueOpportunity = {
  customerId: string
  customerName: string
  agency: string
  state: "growing" | "declining" | "dormant" | "new"
  priorityScore: number
  reason: string
  metrics: {
    currentRevenueTnd: number
    previousRevenueTnd: number
    growthPercent: number | null
    lastPurchase: string | null
    currentMargin: { amount: number | null; coverage: string }
  }
  proposedAction: { type: string; status: "draft_only"; requiresHumanApproval: true }
  evidence: { invoiceIds: string[]; invoiceCount: number }
  warnings: string[]
}
export type RevenueResult = {
  agent: "revenue_growth"
  status: "ok" | "no_data"
  executionMode: "read_only"
  snapshot: {
    asOf: string
    source: string
    scope: string[] | "*"
    current: { from: string; to: string }
    previous: { from: string; to: string }
  }
  analysis: { customersAnalyzed: number; opportunitiesFound: number; returned: number }
  opportunities: RevenueOpportunity[]
  warnings: string[]
}

// This is the existing server contract. No fake backend is called and no secrets are persisted.
const API_BASE = (import.meta.env.VITE_AGENTIC_API_BASE || "").replace(/\/$/, "")

export async function createLocalDemoSession(identity = "admin", signal?: AbortSignal): Promise<string> {
  const res = await fetch(API_BASE + "/api/v1/auth/dev-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity }),
    signal,
  })
  if (!res.ok) throw new Error("Session de démonstration locale indisponible (HTTP " + res.status + ")")
  const session: unknown = await res.json()
  if (!session || typeof session !== "object") throw new Error("Session de développement invalide")
  const data = session as Record<string, unknown>
  const token = typeof data.token === "string" ? data.token
    : typeof data.accessToken === "string" ? data.accessToken
    : typeof data.access_token === "string" ? data.access_token
    : undefined
  if (!token) throw new Error("Aucun jeton dans la réponse de session")
  return token
}

export async function fetchPlatformContext(token: string, signal?: AbortSignal): Promise<PlatformContext> {
  const res = await fetch(API_BASE + "/api/v1/platform/context", {
    headers: { Authorization: "Bearer " + token },
    signal,
  })
  if (!res.ok) throw new Error("Contexte plateforme : HTTP " + res.status)
  const parsed = platformContextSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error("Contrat du contexte plateforme invalide")
  return parsed.data
}

export type { PlatformContext, AnalyticsOverview }

export type SharedFilters = { agency: string; from: string; to: string }
export async function fetchSharedOverview(
  token: string, filters: SharedFilters, signal?: AbortSignal,
): Promise<AnalyticsOverview> {
  const q = new URLSearchParams({ from: filters.from, to: filters.to })
  if (filters.agency !== "all") q.set("agency", filters.agency)
  const response = await fetch(API_BASE + "/api/v1/analytics/overview?" + q, {
    headers: { Authorization: "Bearer " + token },
    signal,
  })
  if (!response.ok) throw new Error("Source analytique commune indisponible (HTTP " + response.status + ")")
  const parsed = analyticsOverviewSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error("Contrat de snapshot analytique invalide")
  return parsed.data
}

export async function fetchRevenueGrowth(
  token: string,
  agency: string,
  signal?: AbortSignal,
): Promise<RevenueResult> {
  const params = new URLSearchParams({ windowDays: "90", dormantDays: "90", limit: "20" })
  if (agency !== "all") params.set("agency", agency)
  const res = await fetch(
    API_BASE + "/api/v1/agentic/revenue-growth/opportunities?" + params.toString(),
    { headers: { Authorization: "Bearer " + token }, signal },
  )
  if (!res.ok) throw new Error("API Revenue Growth : HTTP " + res.status)
  const body: unknown = await res.json()
  if (!body || typeof body !== "object" || (body as { agent?: string }).agent !== "revenue_growth") {
    throw new Error("Contrat API Revenue Growth invalide")
  }
  return body as RevenueResult
}

export type SpecialistAgent = "finance" | "supply" | "strategy"
export type SpecialistReport = {
  agent: string
  status: "ok" | "no_data"
  executionMode: "read_only"
  snapshot: { asOf: string; source: string; scope: string[] | "*"; currency: "TND" }
  metrics: Record<string, number | null>
  findings: Array<{
    id: string
    title: string
    priority: "high" | "medium" | "low"
    explanation: string
    evidence: Array<{ type: string; id: string; agency: string }>
    action: { type: string; status: "draft_only"; requiresHumanApproval: true }
  }>
  scenarios: Array<{ id: string; label: string; assumption: string; valueTnd: number | null }>
  warnings: string[]
}
export type DirectorReport = {
  director: "ai_director"
  orchestrationMode: "deterministic_read_only"
  status: "ok" | "no_data"
  objective: string
  snapshot: { asOf: string; source: string; scope: string[] | "*" }
  plan: Array<{ step: number; agent: string; action: string; status: string }>
  sections: Array<{
    agent: string; status: string;
    metrics: Record<string, number | null>
    findings: SpecialistReport["findings"]
    warnings: string[]
  }>
  highlights: Array<SpecialistReport["findings"][number] & { agent: string }>
  summary: { agentsInvoked: number; totalFindings: number; requiresHumanReview: boolean; erpWrites: number }
  warnings: string[]
}
const SPECIALIST_PATHS: Record<SpecialistAgent,string> = {
  finance:"/api/v1/agentic/financial-strategy/analysis",
  supply:"/api/v1/agentic/supply-chain/recommendations",
  strategy:"/api/v1/agentic/business-strategy/scenarios",
}
export async function fetchSpecialistReport(
  token: string, agent: SpecialistAgent, agency: string, signal?:AbortSignal,
): Promise<SpecialistReport> {
  const params = new URLSearchParams({limit:"20"})
  if (agency !== "all") params.set("agency",agency)
  const response = await fetch(API_BASE + SPECIALIST_PATHS[agent] + "?" + params, {
    headers:{Authorization:"Bearer " + token},signal,
  })
  if (!response.ok) throw new Error("API " + agent + " : HTTP " + response.status)
  const report = await response.json() as SpecialistReport
  if (report.executionMode !== "read_only" || !Array.isArray(report.findings)) throw new Error("Réponse Agent invalide")
  return report
}
export async function fetchDirectorReport(
  token: string, objective: string, agency: string, signal?:AbortSignal,
): Promise<DirectorReport> {
  const response = await fetch(API_BASE + "/api/v1/agentic/ai-director/investigate", {
    method:"POST",
    headers:{Authorization:"Bearer " + token,"Content-Type":"application/json"},
    body:JSON.stringify({objective,...(agency==="all"?{}:{agency})}),
    signal,
  })
  if (!response.ok) throw new Error("AI Director : HTTP " + response.status)
  const report = await response.json() as DirectorReport
  if (report.orchestrationMode !== "deterministic_read_only") throw new Error("Réponse Director invalide")
  return report
}
