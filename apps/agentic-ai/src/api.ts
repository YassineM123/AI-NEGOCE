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

export async function createLocalDemoSession(signal?: AbortSignal): Promise<string> {
  const res = await fetch(API_BASE + "/api/v1/auth/dev-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin" }),
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
