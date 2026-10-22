export type ApiState<T> = { data?: T; error?: string }
export * from "./features/bi-360/types"
export type ValidationIssue = { code: string; message: string; severity: "blocking" | "warning"; field?: string; line?: number }
export type DocumentValidation = {
  ready: boolean
  issues: ValidationIssue[]
  rules: { revision: number; verified: boolean; source?: string } | null
}
export type DocumentHistoryEvent = {
  id: string
  actorId: string
  actorName: string | null
  action: string
  metadata: Record<string, unknown>
  createdAt: string
}
export type DashboardPeriod = "month" | "quarter" | "year"
export type DashboardData = {
  asOf: string
  period: DashboardPeriod
  range: { from: string; to: string }
  previousRange: { from: string; to: string }
  kpis: {
    revenue: number
    revenueChangePct: number | null
    grossMargin: number
    grossMarginPct: number | null
    grossMarginChangePts: number | null
    receivables: number
    overdueReceivables: number
    averageReceivableAgeDays: number | null
    inventoryValue: number
    dormantInventoryPct: number | null
    invoiceCount: number
  }
  trend: { month: string; revenue: number }[]
  activity: {
    id: string
    number: string
    date: string
    party: string
    type: string
    amount: number
    status: string
  }[]
  alerts: {
    lateReceivables: { count: number; amount: number }
    belowReorderPoint: number
    overCreditLimit: { count: number; amount: number }
    marginDrops: { category: string; agency: string; deltaPts: number }[]
    marginDropCount: number
  }
  agencies: string[]
  source: string
}
export type PageModule = "sales" | "purchases" | "inventory" | "finance"
export type Tone = "success" | "warning" | "danger" | "info" | "neutral"
export type PageData = {
  module: PageModule
  asOf: string
  tab: string
  tabs: { id: string; label: string }[]
  columns: { label: string; type: "text" | "date" | "money" | "signed" | "qty" }[]
  rows: {
    id: string
    cells: (string | number | null)[]
    status: { label: string; tone: Tone }
    action?: { id: "pay" | "receive"; label: string }
  }[]
  total: number
  page: number
  pageSize: number
  stats: {
    label: string
    value: number
    unit: "DT" | "%" | "j" | ""
    delta: string | null
    deltaTone?: "up" | "down"
    note: string
    icon: string
    tone: string
  }[]
}
export type Lookups = {
  asOf: string
  agencies: { id: string; name: string }[]
  categories: { id: string; name: string; vatRate: number }[]
  customers: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
  products: { id: string; sku: string; name: string; unitCost: number | null; listPrice: number | null; vatRate: number | null }[]
  openInvoices: { id: string; number: string; customer: string; outstanding: number }[]
}
export type BiPeriod = "month" | "quarter" | "year" | "all"
export type BiData = {
  asOf: string
  period: BiPeriod
  range: { from: string; to: string }
  previousRange: { from: string; to: string } | null
  agencyNames: string[]
  kpis: {
    revenue: number
    revenueChangePct: number | null
    grossMargin: number
    grossMarginPct: number | null
    grossMarginChangePts: number | null
    receivables: number
    overdueReceivables: number
    inventoryValue: number
    dormantInventory: number
    invoiceCount: number
  }
  monthly: { month: string; revenue: number; margin: number }[]
  agencies: { agency: string; revenue: number; changePct: number | null; margin: number; marginPct: number | null; sharePct: number }[]
  stockAging: { active: number; watch: number; dormant: number }
  anomalies: { severity: "high" | "medium" | "low"; kind: "margin" | "receivable" | "stock"; title: string; subject: string; detail: string }[]
  marginDrops: { category: string; categoryId: string; agency: string; deltaPts: number; marginPct: number; previousMarginPct: number }[]
  marginFocus: null | {
    category: string
    categoryId: string
    agency: string
    revenue: number
    margin: number
    marginPct: number | null
    previousMarginPct: number
    expectedMargin: number
    gap: number
    factors: { label: string; value: number }[]
    products: { sku: string; name: string; qty: number; revenue: number; averageCost: number; marginPct: number; gap: number }[]
    invoiceCount: number
    invoices: { number: string; date: string; customer: string; revenue: number; cost: number; margin: number; marginPct: number | null }[]
  }
}

export type CopilotSource = {
  label: string
  dataset: string
  agency?: string
  asOf?: string
  referenceId?: string
}

export type CopilotTable = {
  columns: string[]
  rows: (string | number | null)[][]
}

export type CopilotQueryResult = {
  status?: "ok" | "denied" | "unsupported" | "error"
  answer: string
  sources: CopilotSource[]
  table?: CopilotTable
  suggestedFollowUps?: string[]
  followups?: string[]
  conversationId?: string
  language?: string
  confidence?: number
  tool?: string
  metadata?: Record<string, unknown>
}

export type ConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount?: number
  lastMessage?: string
}

export type ConversationTurn = {
  id?: string
  role: "user" | "assistant"
  content: string
  sources?: CopilotSource[]
  table?: CopilotTable
  createdAt: string
}

export type ConversationDetail = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ConversationTurn[]
}

export type CopilotStreamCallbacks = {
  onInit?: (data: { conversationId: string; title: string }) => void
  onStatus?: (data: { state: string; message: string }) => void
  onTool?: (data: { tool: string; status: string }) => void
  onDelta?: (delta: string) => void
  onDone?: (data: CopilotQueryResult) => void
  onError?: (err: Error) => void
}

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:3001/api/v1"
const post = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

export type Session = {
  id: string
  name: string
  role: "admin" | "manager" | "accountant" | "commercial"
  agencies: string[]
  organization: { id: string; name: string; isSynthetic: boolean }
  authMode: "oidc" | "local-dev"
  /** What the screens actually read: the synthetic sandbox, a verified ERP connector, or nothing. */
  dataSource: { kind: "sandbox" | "erp" | "none"; label: string }
  erpStatus: "not_configured" | "available" | "unavailable"
}
export type FinancialRulesResponse = {
  revision: number
  rules: {
    currency: string
    moneyScale: number
    roundingMode: string
    vatRounding: "line" | "document"
    vatRates: { code: string; rate: string; label: string }[]
    stampDuty: string | null
    tolerance: string
    maxDiscountPct: string | null
    verified: boolean
    verifiedBy: string | null
    verifiedAt: string | null
    source: string
  }
}

export type Extraction = {
  fields: Record<string, unknown>
  missingFields: string[]
  provider: string
  confidence: number | null
  sources?: Record<string, { page: number; bbox: BoundingBox }>
  events?: ProcessingEvent[]
  document?: {
    provider: string
    engine: string
    languages: string[]
    warnings: string[]
    durationMs: number
    pages: Array<{
      page: number
      width: number
      height: number
      source: "native_text" | "image_ocr"
      rotationApplied: 0 | 90 | 180 | 270
      meanConfidence: number | null
      lines: Array<{ text: string; bbox: BoundingBox }>
    }>
  }
}

export type BoundingBox = { x0: number; y0: number; x1: number; y1: number }
export type ProcessingEvent = {
  stage: string
  at: string
  page?: number
  pages?: number
  progress?: number
  detail?: string
}

export type DocumentResponse = {
  id: string
  filename: string
  mimeType: string
  size: number
  status: string
  extraction: Extraction | null
  processing?: {
    status: "pending" | "succeeded" | "failed"
    events: ProcessingEvent[]
    error: { code: string; message: string } | null
  }
  capabilities?: {
    canCorrect: boolean
    canApprove: boolean
    canReject: boolean
    canReopen: boolean
    canRetry: boolean
    canIntegrate: boolean
  }
  erpSubmission: {
    status: string
    adapter: string
    invoiceId?: string
    invoiceNumber?: string
    supplierName?: string
    totalTtc?: number
    integratedAt?: string
  }
}

export type DocumentSummary = {
  id: string
  filename: string
  mimeType: string
  size: number
  status: string
  agency: string
  createdAt: string
  erpSubmission: {
    status: string
    adapter: string
    invoiceId?: string
    invoiceNumber?: string
    supplierName?: string
    totalTtc?: number
    integratedAt?: string
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// Local development only (API started with AUTH_MODE=local-dev): the API issues a short-lived
// token for the identity named in VITE_DEV_IDENTITY, which is a name, not a credential.
// Production builds replace import.meta.env.DEV with false, so this code and the identity are
// dropped from the bundle; without a token the API answers 401 (no implicit fallback).
function createDevSession() {
  let session: Promise<string | null> | null = null
  return {
    token() {
      const identity = import.meta.env.VITE_DEV_IDENTITY
      if (!identity) return Promise.resolve(null)
      session ??= fetch(`${API_URL}/auth/dev-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity }),
      })
        .then(async (r) => (r.ok ? ((await r.json()).token as string) : null))
        .catch(() => null)
        .then((token) => {
          if (!token) session = null
          return token
        })
      return session
    },
    reset() {
      session = null
    },
  }
}
const devSession = import.meta.env.DEV
  ? createDevSession()
  : { token: () => Promise.resolve(null), reset() {} }

async function request<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = await devSession.token()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  // An expired development session (or a restarted API with a new key) is renewed once.
  if (response.status === 401 && token && !retried) {
    devSession.reset()
    return request<T>(path, init, true)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new ApiError(
      body?.error?.message || `Erreur API ${response.status}`,
      response.status,
      body?.error?.code,
      body?.error?.details,
    )
  return body as T
}

async function requestBlob(path: string, retried = false): Promise<Blob> {
  const headers = new Headers()
  const token = await devSession.token()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(`${API_URL}${path}`, { headers })
  if (response.status === 401 && token && !retried) {
    devSession.reset()
    return requestBlob(path, true)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(
      body?.error?.message || `Erreur API ${response.status}`,
      response.status,
      body?.error?.code,
      body?.error?.details,
    )
  }
  return response.blob()
}

export const api = {
  me: () => request<Session>("/me"),
  financialRules: () => request<FinancialRulesResponse>("/settings/financial-rules"),
  health: () =>
    request<{ status: string; mode?: string; erp?: string; ocr?: string }>("/livez"),
  overview: (agency = "all", period: { from?: string; to?: string } = {}) =>
    request<any>(
      `/bi/overview?${new URLSearchParams({
        agency,
        ...(period.from ? { from: period.from } : {}),
        ...(period.to ? { to: period.to } : {}),
      })}`,
    ),
  dashboard: (period: DashboardPeriod, agency = "all") =>
    request<DashboardData>(`/dashboard?${new URLSearchParams({ period, agency })}`),
  page: (module: PageModule, params: { tab: string; days: string; q: string; page: number }) =>
    request<PageData>(
      `/erp/pages/${module}?${new URLSearchParams({ ...params, page: String(params.page) })}`,
    ),
  lookups: () => request<Lookups>("/erp/lookups"),
  bi360: (period: BiPeriod, agency = "all", focus?: { categoryId: string; agency: string }) =>
    request<BiData>(
      `/bi/360?${new URLSearchParams({
        period,
        agency,
        ...(focus ? { category: focus.categoryId, focusAgency: focus.agency } : {}),
      })}`,
    ),
  biCockpit: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").ExecutiveCockpitResponse>(`/bi/360/cockpit?${p}`)
  },
  biSales: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").SalesIntelligenceResponse>(`/bi/360/sales?${p}`)
  },
  biProfitability: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").ProfitabilityResponse>(`/bi/360/profitability?${p}`)
  },
  biPurchases: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").PurchasesResponse>(`/bi/360/purchases?${p}`)
  },
  biInventory: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").InventoryResponse>(`/bi/360/inventory?${p}`)
  },
  biFinance: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").FinanceResponse>(`/bi/360/finance?${p}`)
  },
  biDiagnostics: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    if (filters.customerId) p.set("customerId", filters.customerId)
    if (filters.supplierId) p.set("supplierId", filters.supplierId)
    if (filters.categoryId) p.set("categoryId", filters.categoryId)
    if (filters.productId) p.set("productId", filters.productId)
    if (filters.repId) p.set("repId", filters.repId)
    return request<import("./features/bi-360/types").DiagnosticsResponse>(`/bi/360/diagnostics?${p}`)
  },
  biAlerts: (includeAcknowledged = false) =>
    request<{ alerts: import("./features/bi-360/types").BusinessAlert[]; totalCount: number; criticalCount: number }>(
      `/bi/360/alerts?includeAcknowledged=${includeAcknowledged}`,
    ),
  biAcknowledgeAlert: (id: string) =>
    post<{ success: boolean; alertId: string }>(`/bi/360/alerts/${encodeURIComponent(id)}/acknowledge`, {}),
  biForecasting: (filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    return request<import("./features/bi-360/types").ForecastingResponse>(`/bi/360/forecasting?${p}`)
  },
  biExportUrl: (module: string, format: "csv" | "json" = "csv", filters: import("./features/bi-360/types").BiUniversalFilters = {}) => {
    const p = new URLSearchParams({ module, format })
    if (filters.period) p.set("period", filters.period)
    if (filters.agency) p.set("agency", filters.agency)
    if (filters.from) p.set("from", filters.from)
    if (filters.to) p.set("to", filters.to)
    return `${API_URL}/bi/360/export?${p}`
  },
  createSalesInvoice: (body: unknown) => post<{ id: string; number: string }>("/erp/sales-invoices", body),
  createPurchaseOrder: (body: unknown) => post<{ id: string }>("/erp/purchase-orders", body),
  receivePurchaseOrder: (id: string, body: { date: string; supplierInvoiceNumber?: string }) =>
    post<{ supplierInvoiceId: string; number: string }>(`/erp/purchase-orders/${encodeURIComponent(id)}/receive`, body),
  createStockMovement: (body: unknown) => post<{ reference: string }>("/erp/stock-movements", body),
  createPayment: (body: unknown) => post<{ id: string; outstanding: number }>("/erp/payments", body),
  conversations: (q?: string, limit?: number) =>
    request<{ conversations: ConversationSummary[]; total?: number }>(
      `/conversations?${new URLSearchParams({
        ...(q ? { q } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      })}`,
    ),
  conversation: (id: string) =>
    request<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`),
  createConversation: (title?: string) =>
    post<ConversationDetail>("/conversations", { title }),
  updateConversation: (id: string, title: string) =>
    request<{ id: string; title: string }>(`/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: string) =>
    request<{ success: boolean; id: string }>(`/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  copilotPreferences: () =>
    request<{ preferences: Record<string, unknown> }>("/copilot/preferences"),
  setCopilotPreference: (key: string, value: unknown) =>
    request<{ success: boolean }>("/copilot/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }),
  deleteCopilotPreference: (key?: string) =>
    request<{ success: boolean }>(
      `/copilot/preferences${key ? `?key=${encodeURIComponent(key)}` : ""}`,
      { method: "DELETE" },
    ),
  ask: (
    question: string,
    conversationId?: string,
    filters?: { agency?: string; from?: string; to?: string },
  ) =>
    request<CopilotQueryResult>("/copilot/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, conversationId, filters }),
    }),
  askStream: async (
    question: string,
    options?: {
      conversationId?: string
      filters?: { agency?: string; from?: string; to?: string }
      signal?: AbortSignal
      callbacks?: CopilotStreamCallbacks
    },
  ): Promise<CopilotQueryResult> => {
    const token = await devSession.token()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`

    const response = await fetch(`${API_URL}/copilot/query/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        question,
        conversationId: options?.conversationId,
        filters: options?.filters,
      }),
      signal: options?.signal,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(
        body?.error?.message || `Erreur API ${response.status}`,
        response.status,
        body?.error?.code,
        body?.error?.details,
      )
    }

    if (!response.body) {
      throw new Error("Flux non disponible")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let finalResult: CopilotQueryResult | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split("\n\n")
      buffer = blocks.pop() || ""

      for (const block of blocks) {
        if (!block.trim()) continue
        const eventMatch = block.match(/^event:\s*(.+)$/m)
        const dataMatch = block.match(/^data:\s*(.+)$/m)
        const event = eventMatch ? eventMatch[1].trim() : "message"
        let data: any = null
        if (dataMatch) {
          try {
            data = JSON.parse(dataMatch[1])
          } catch {
            data = dataMatch[1]
          }
        }

        if (event === "init") {
          options?.callbacks?.onInit?.(data)
        } else if (event === "status") {
          options?.callbacks?.onStatus?.(data)
        } else if (event === "tool") {
          options?.callbacks?.onTool?.(data)
        } else if (event === "delta") {
          options?.callbacks?.onDelta?.(data?.delta ?? "")
        } else if (event === "done") {
          finalResult = data as CopilotQueryResult
          options?.callbacks?.onDone?.(data)
        } else if (event === "error") {
          const err = new Error(data?.message || "Erreur de streaming")
          options?.callbacks?.onError?.(err)
          throw err
        }
      }
    }

    if (!finalResult) {
      throw new Error("Flux terminé sans réponse finale")
    }
    return finalResult
  },
  upload: (file: File) => {
    const form = new FormData()
    form.append("file", file)
    form.append("agency", "Tunis Centre")
    return request<DocumentResponse>("/documents", { method: "POST", body: form })
  },
  document: (id: string) =>
    request<DocumentResponse>(`/documents/${encodeURIComponent(id)}`),
  documentFile: (id: string) =>
    requestBlob(`/documents/${encodeURIComponent(id)}/file`),
  documentValidation: (id: string) =>
    request<DocumentValidation>(`/documents/${encodeURIComponent(id)}/validation`),
  documentHistory: (id: string) =>
    request<{ events: DocumentHistoryEvent[] }>(`/documents/${encodeURIComponent(id)}/history`),
  approveDocument: (id: string) =>
    post<{ id: string; status: string }>(`/documents/${encodeURIComponent(id)}/approve`, {}),
  rejectDocument: (id: string, reason: string) =>
    post<{ id: string; status: string }>(`/documents/${encodeURIComponent(id)}/reject`, { reason }),
  reopenDocument: (id: string) =>
    post<{ id: string; status: string }>(`/documents/${encodeURIComponent(id)}/reopen`, {}),
  retryDocument: (id: string) =>
    post<DocumentResponse>(`/documents/${encodeURIComponent(id)}/retry`, {}),
  integrateDocumentPurchase: (id: string, body: { supplierId: string; productIds: string[]; receiptConfirmed: true }) =>
    post<{ status: string; adapter: string; invoiceId: string }>(`/documents/${encodeURIComponent(id)}/purchases`, body),
  documents: (agency = "all") =>
    request<{ documents: DocumentSummary[] }>(
      `/documents?${new URLSearchParams({ agency })}`,
    ),
}
