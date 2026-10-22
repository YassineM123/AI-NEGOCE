import type { AgencyScope } from "../auth.js"
import type { DashboardPeriod, Period } from "../erp-db.js"

export type BiUniversalPeriod = "month" | "quarter" | "year" | "custom" | "all"

export interface BiUniversalFilters {
  period?: BiUniversalPeriod
  from?: string // YYYY-MM-DD
  to?: string // YYYY-MM-DD
  agency?: string // "all" or specific agency name
  customerId?: string
  supplierId?: string
  categoryId?: string
  productId?: string
  repId?: string
}

export interface MetricDefinition {
  id: string
  name: string
  shortLabel: string
  description: string
  formula: string
  unit: "DT" | "%" | "pts" | "u" | "j"
  currency?: string
  sourceTables: string[]
  drillDownLevels: ("company" | "agency" | "rep" | "customer" | "product" | "invoice" | "supplier" | "category")[]
}

export type AlertSeverity = "critical" | "warning" | "info"

export interface BusinessAlert {
  id: string
  severity: AlertSeverity
  category: "margin" | "receivables" | "stock" | "purchases" | "customer"
  title: string
  subject: string
  detail: string
  threshold: string
  detectedAt: string
  entityType?: "customer" | "product" | "category" | "supplier" | "agency"
  entityId?: string
  acknowledged?: boolean
  linkAction?: {
    tab: string
    filterKey?: string
    filterValue?: string
  }
}

export interface CockpitKpiCard {
  id: string
  label: string
  value: number
  previousValue: number | null
  deltaPct: number | null
  deltaPts?: number | null
  unit: "DT" | "%" | "u" | "j"
  subtitle: string
  tone?: "blue" | "green" | "amber" | "red" | "purple"
  tooltip: string
  formula: string
}

export interface ExecutiveCockpitResponse {
  asOf: string
  period: BiUniversalPeriod
  range: { from: string; to: string }
  previousRange: { from: string; to: string } | null
  filters: BiUniversalFilters
  kpis: {
    revenueHt: CockpitKpiCard
    grossMargin: CockpitKpiCard
    markupRate: CockpitKpiCard // Taux de marque = Marge / CA
    marginRate: CockpitKpiCard // Taux de marge = Marge / Coût
    purchasesHt: CockpitKpiCard
    receivablesTotal: CockpitKpiCard
    receivablesOverdue: CockpitKpiCard
    supplierPayables: CockpitKpiCard
    inventoryValuation: CockpitKpiCard
    dormantInventory: CockpitKpiCard
    cashInflow: CockpitKpiCard
    openOrdersCount: CockpitKpiCard
    salesTarget: CockpitKpiCard
    targetAchievementRate: CockpitKpiCard
  }
  monthlyTrend: {
    month: string
    revenue: number
    margin: number
    purchases: number
  }[]
  agenciesPerformance: {
    agency: string
    revenue: number
    margin: number
    markupRate: number | null
    sharePct: number
    growthPct: number | null
  }[]
  inventoryAgingSummary: {
    active: number
    watch: number
    dormant: number
  }
  recentAnomalies: BusinessAlert[]
}

export interface SalesIntelligenceResponse {
  asOf: string
  range: { from: string; to: string }
  previousRange: { from: string; to: string } | null
  kpis: {
    totalSalesHt: number
    salesGrowthPct: number | null
    totalInvoices: number
    averageOrderValue: number
    activeCustomersCount: number
    newCustomersCount: number
    totalDiscountsGranted: number
    averageDiscountPct: number
  }
  monthlyTrend: {
    month: string
    revenue: number
    ordersCount: number
    averageBasket: number
  }[]
  topCustomers: {
    id: string
    name: string
    agency: string
    segment: string
    revenue: number
    sharePct: number
    invoicesCount: number
    marginPct: number | null
  }[]
  paretoCustomers: {
    rank: number
    name: string
    revenue: number
    cumulativeSharePct: number
    segment: "A" | "B" | "C"
  }[]
  topProducts: {
    id: string
    sku: string
    name: string
    category: string
    quantitySold: number
    revenue: number
    marginPct: number | null
  }[]
  salesByRep: {
    id: string
    name: string
    agency: string
    revenue: number
    invoicesCount: number
    marginPct: number | null
  }[]
  salesByCategory: {
    categoryId: string
    name: string
    revenue: number
    sharePct: number
    marginPct: number | null
  }[]
  customerSegments: {
    segment: string
    customersCount: number
    revenue: number
    sharePct: number
  }[]
}

export interface ProfitabilityResponse {
  asOf: string
  range: { from: string; to: string }
  previousRange: { from: string; to: string } | null
  kpis: {
    grossMargin: number
    marginGrowthPts: number | null
    markupRate: number | null
    marginRate: number | null
    negativeMarginLoss: number
    negativeMarginCount: number
  }
  waterfallBridge: {
    previousMargin: number
    currentMargin: number
    gap: number
    factors: {
      id: "volume_mix" | "price" | "cost" | "discount"
      label: string
      impact: number
      description: string
    }[]
  }
  marginByCategory: {
    id: string
    name: string
    revenue: number
    cost: number
    margin: number
    markupRate: number | null
    previousMarkupRate: number | null
    deltaPts: number | null
  }[]
  marginByCustomer: {
    id: string
    name: string
    revenue: number
    cost: number
    margin: number
    markupRate: number | null
  }[]
  negativeMarginSales: {
    invoiceNumber: string
    date: string
    customer: string
    product: string
    quantity: number
    unitPrice: number
    unitCost: number
    lossAmount: number
  }[]
}

export interface PurchasesResponse {
  asOf: string
  range: { from: string; to: string }
  previousRange: { from: string; to: string } | null
  kpis: {
    totalPurchasesHt: number
    purchasesGrowthPct: number | null
    activeSuppliersCount: number
    supplierConcentrationTop3Pct: number
    totalPurchaseOrders: number
    openOrdersValue: number
  }
  monthlyPurchases: {
    month: string
    purchasesHt: number
    ordersCount: number
  }[]
  topSuppliers: {
    id: string
    name: string
    city: string
    totalPurchasesHt: number
    sharePct: number
    invoicesCount: number
    paymentTermsDays: number
  }[]
  supplierConcentrationPareto: {
    rank: number
    name: string
    purchasesHt: number
    cumulativeSharePct: number
  }[]
  priceEvolutionAlerts: {
    productId: string
    sku: string
    productName: string
    supplierName: string
    initialUnitCost: number
    latestUnitCost: number
    inflationPct: number
    impactDt: number
  }[]
  recentPurchaseOrders: {
    id: string
    date: string
    supplier: string
    agency: string
    status: string
    totalHt: number
  }[]
}

export interface InventoryResponse {
  asOf: string
  kpis: {
    totalValuation: number
    dormantValuation: number
    dormantPct: number
    reorderAlertCount: number
    averageTurnoverRatio: number
    estimatedCoverageDays: number
  }
  valuationByAgency: {
    agency: string
    valuation: number
    itemsCount: number
    sharePct: number
  }[]
  valuationByCategory: {
    category: string
    valuation: number
    sharePct: number
  }[]
  abcClassification: {
    class: "A" | "B" | "C"
    label: string
    itemsCount: number
    valuation: number
    sharePct: number
    description: string
  }[]
  xyzDemandAnalysis: {
    variability: "X" | "Y" | "Z"
    label: string
    itemsCount: number
    description: string
  }[]
  reorderRecommendations: {
    productId: string
    sku: string
    productName: string
    agency: string
    currentQuantity: number
    reorderPoint: number
    suggestedReorderQuantity: number
    unitCost: number
    stockoutRisk: "high" | "medium"
  }[]
  dormantItems: {
    productId: string
    sku: string
    productName: string
    agency: string
    quantity: number
    unitCost: number
    valuation: number
    daysSinceLastSale: number | null
  }[]
}

export interface FinanceResponse {
  asOf: string
  range: { from: string; to: string }
  kpis: {
    totalReceivables: number
    overdueReceivables: number
    overduePct: number
    dsoDays: number
    totalSupplierPayables: number
    totalCollectedPeriod: number
    averagePaymentDelayDays: number
  }
  agingBuckets: {
    bucket: "0-30" | "31-60" | "61-90" | "90+"
    label: string
    amount: number
    invoicesCount: number
    sharePct: number
    tone: "success" | "info" | "warning" | "danger"
  }[]
  topDebtorCustomers: {
    customerId: string
    name: string
    agency: string
    outstandingAmount: number
    overdueAmount: number
    oldestDueDays: number
    creditLimit: number | null
    isOverLimit: boolean
  }[]
  collectionByMethod: {
    method: string
    amount: number
    paymentsCount: number
    sharePct: number
  }[]
  monthlyCollectionTrend: {
    month: string
    invoicedTtc: number
    collectedTtc: number
  }[]
  cashInflowForecast: {
    periodLabel: string
    expectedReceivables: number
    expectedPayables: number
    netProjectedBalance: number
  }[]
}

export interface DiagnosticsResponse {
  asOf: string
  range: { from: string; to: string }
  previousRange: { from: string; to: string }
  diagnostics: {
    id: string
    question: string
    executiveSummary: string
    initialValue: number
    finalValue: number
    variation: number
    variationPct: number | null
    contributors: {
      dimension: string
      name: string
      contribution: number
      pctOfTotalVariation: number
      explanation: string
    }[]
    methodology: string
    confidence: "deterministic" | "high" | "moderate"
  }[]
}

export interface ForecastingResponse {
  asOf: string
  historicalMonthsRange: { from: string; to: string }
  forecastHorizonMonths: number
  accuracyMetrics: {
    method: string
    mape: number // Mean Absolute Percentage Error
    rmse: number
    backtestWindow: string
  }
  salesForecast: {
    month: string
    historicalActual: number | null
    forecastValue: number | null
    lowerConfidenceBound: number | null
    upperConfidenceBound: number | null
  }[]
  simulations: {
    priceSensitivity: {
      priceAdjustmentPct: number
      simulatedRevenue: number
      simulatedGrossMargin: number
      deltaMarginDt: number
    }[]
    costInflationSensitivity: {
      costAdjustmentPct: number
      simulatedGrossMargin: number
      deltaMarginDt: number
      markupRatePct: number
    }[]
  }
}
