export type ApiState<T> = { data?: T; error?: string }
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

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api/v1"
const post = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

export type Extraction = {
  fields: Record<string, unknown>
  missingFields: string[]
  provider: string
  confidence: number | null
}

export type DocumentResponse = {
  id: string
  filename: string
  mimeType: string
  size: number
  status: string
  extraction: Extraction | null
  erpSubmission: { status: string; adapter: string }
}

export type DocumentSummary = {
  id: string
  filename: string
  mimeType: string
  size: number
  status: string
  agency: string
  createdAt: string
  erpSubmission: { status: string; adapter: string }
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set(
    "Authorization",
    `Bearer ${import.meta.env.VITE_DEV_TOKEN || "dev-admin"}`,
  )
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
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

export const api = {
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
  createSalesInvoice: (body: unknown) => post<{ id: string; number: string }>("/erp/sales-invoices", body),
  createPurchaseOrder: (body: unknown) => post<{ id: string }>("/erp/purchase-orders", body),
  receivePurchaseOrder: (id: string, body: { date: string; supplierInvoiceNumber?: string }) =>
    post<{ supplierInvoiceId: string; number: string }>(`/erp/purchase-orders/${encodeURIComponent(id)}/receive`, body),
  createStockMovement: (body: unknown) => post<{ reference: string }>("/erp/stock-movements", body),
  createPayment: (body: unknown) => post<{ id: string; outstanding: number }>("/erp/payments", body),
  ask: (question: string) =>
    request<any>("/copilot/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  upload: (file: File) => {
    const form = new FormData()
    form.append("file", file)
    form.append("agency", "Tunis Centre")
    return request<DocumentResponse>("/documents", { method: "POST", body: form })
  },
  document: (id: string) =>
    request<DocumentResponse>(`/documents/${encodeURIComponent(id)}`),
  documents: (agency = "all") =>
    request<{ documents: DocumentSummary[] }>(
      `/documents?${new URLSearchParams({ agency })}`,
    ),
}
