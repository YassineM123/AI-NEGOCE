import { z } from "zod"

export const ANALYTICS_CONTRACT_VERSION = "1.0" as const

export const analyticsPermissionSchema = z.enum([
  "analytics.bi.read",
  "analytics.ds.read",
  "agentic.read",
])
export type AnalyticsPermission = z.infer<typeof analyticsPermissionSchema>

export const platformStatusSchema = z.enum([
  "available",
  "unavailable",
  "not_configured",
  "forbidden",
])

const scopeSchema = z.union([z.literal("*"), z.array(z.string())])

export const platformContextSchema = z.object({
  contractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  generatedAt: z.string().datetime(),
  principal: z.object({
    id: z.string(),
    organizationId: z.string(),
    role: z.enum(["admin", "manager", "accountant", "commercial"]),
    agencies: scopeSchema,
  }),
  permissions: z.array(analyticsPermissionSchema),
  platforms: z.object({
    bi: z.object({ status: platformStatusSchema }),
    dataScience: z.object({
      status: platformStatusSchema,
      modelServingVerified: z.literal(false),
    }),
    agentic: z.object({
      status: platformStatusSchema,
      executionMode: z.literal("read_only"),
    }),
  }),
})
export type PlatformContext = z.infer<typeof platformContextSchema>

const biOverviewSchema = z.object({
  revenue: z.number(),
  cost: z.number(),
  grossMargin: z.number(),
  grossMarginPercent: z.number().nullable(),
  receivables: z.number(),
  overdue: z.number(),
  inventoryValue: z.number(),
  recordCount: z.number().int().nonnegative(),
  missingCostRecords: z.number().int().nonnegative(),
  marginCoverage: z.enum(["complete", "partial", "none"]),
  filters: z.object({
    agencies: scopeSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  metadata: z.object({
    source: z.string(),
    asOf: z.string(),
    lastUpdated: z.string().optional(),
    currency: z.string().optional(),
  }).passthrough(),
})


export const analyticsInsightsSchema = z.object({
  currency: z.literal("TND"),
  basis: z.literal("posted_sales_net_ht"),
  referenceDate: z.string(),
  months: z.array(z.object({
    month: z.string(), revenue: z.number(), documents: z.number().int().nonnegative(),
    customers: z.number().int().nonnegative(), closed: z.boolean(),
  })),
  topCustomers: z.array(z.object({
    id: z.string(), name: z.string(), revenue: z.number(),
    documents: z.number().int().nonnegative(), lastPurchase: z.string(),
    daysSinceLastPurchase: z.number().int().nonnegative(), sharePercent: z.number().nullable(),
  })),
  summary: z.object({
    revenue: z.number(), salesRows: z.number().int().nonnegative(),
    documentCount: z.number().int().nonnegative(),
    customerCount: z.number().int().nonnegative(),
    topFiveSharePercent: z.number().nullable(),
    monthlyChangePercent: z.number().nullable(), historyTruncated: z.boolean(),
  }),
  coverage: z.object({
    costKnownRows: z.number().int().nonnegative(),
    costMissingRows: z.number().int().nonnegative(),
    receivablesAvailable: z.boolean(), inventoryValuationAvailable: z.boolean(),
    agencyAttributionAvailable: z.boolean(), invoiceItemLinksAvailable: z.boolean(),
    modelServingVerified: z.literal(false),
  }),
  warnings: z.array(z.string()),
})
export type AnalyticsInsights = z.infer<typeof analyticsInsightsSchema>


/** Experimental, read-only Data Science outputs on the governed BI dataset. */
export const governedDataScienceSchema=z.object({
  version:z.literal("ds-scoped-v1"),mode:z.literal("governed_read_only"),
  source:z.string(),asOf:z.string(),referenceDate:z.string(),
  portfolio:z.object({
    status:z.enum(["observed","no_data"]),
    customers:z.number().int().nonnegative(),
    inactive90:z.number().int().nonnegative(),watch30to89:z.number().int().nonnegative(),
    recent0to29:z.number().int().nonnegative(),
    scoring:z.literal("observed_recency_not_churn_probability"),
    top:z.array(z.object({
      customerId:z.string(),name:z.string(),revenueTnd:z.number(),
      documents:z.number().int().nonnegative(),daysSinceLastPurchase:z.number().int().nonnegative(),
      segment:z.enum(["inactive_90","watch_30_89","recent_0_29"]),
    })),
  }),
  trend:z.object({
    months:analyticsInsightsSchema.shape.months,changePercent:z.number().nullable(),
    classification:z.enum(["not_comparable","declining","growing","stable"]),
    method:z.literal("consecutive_closed_months_only"),
  }),
  forecast:z.object({
    status:z.enum(["backtested_pilot","insufficient_history","rejected_backtest"]),
    modelVersion:z.string(),trainedThrough:z.string().nullable(),
    trainingMonths:z.number().int().nonnegative(),
    backtest:z.object({
      holdoutMonths:z.number().int().nonnegative(),
      wape:z.number().nullable(),bias:z.number().nullable(),thresholdWape:z.number(),
    }),
    predictions:z.array(z.object({
      month:z.string(),revenueTnd:z.number(),lowerTnd:z.number(),upperTnd:z.number(),
    })),
    verifiedProduction:z.literal(false),warnings:z.array(z.string()),
  }),
  skuDemand:z.object({
    status:z.literal("pilot_not_certified"),eligibleForAutonomousActions:z.literal(false),
    quantityCoverage:z.object({salesRows:z.number().int().nonnegative(),withQuantity:z.number().int().nonnegative()}),
    evaluated:z.number().int().nonnegative(),backtested:z.number().int().nonnegative(),
    results:z.array(z.object({
      status:z.enum(["backtested_pilot","insufficient_history","rejected_backtest"]),
      agency:z.string(),productId:z.string(),product:z.string(),modelVersion:z.string(),
      model:z.enum(["last_observation","moving_average_3","seasonal_12"]).nullable(),
      trainedThrough:z.string().nullable(),historyMonths:z.number().int().nonnegative(),
      backtest:z.object({
        holdoutMonths:z.number().int().nonnegative(),wape:z.number().nullable(),
        baselineWape:z.number().nullable(),bias:z.number().nullable(),
      }),
      forecast:z.object({month:z.string(),quantity:z.number()}).nullable(),
      reason:z.string(),
    })),
    warnings:z.array(z.string()),
  }),
  advancedModels:z.object({
    inactivity:z.object({
      status:z.enum(["backtested_pilot","insufficient_history","rejected_backtest"]),
      model:z.string().nullable(),version:z.string(),
      verifiedProduction:z.literal(false),eligibleForAutonomousActions:z.literal(false),
      trainSamples:z.number().int().nonnegative(),
      holdoutSamples:z.number().int().nonnegative(),
      candidates:z.array(z.object({name:z.string(),metric:z.enum(["brier","wape","mae_days"]),score:z.number().nullable()})),
      baselineScore:z.number().nullable(),selectedScore:z.number().nullable(),
      forecast:z.number().nullable(),reason:z.string(),
      note:z.string().optional(),holdoutCutoffs:z.array(z.string()).optional(),
    }),
    collections:z.object({
      status:z.enum(["backtested_pilot","insufficient_history","rejected_backtest"]),
      model:z.string().nullable(),version:z.string(),
      verifiedProduction:z.literal(false),eligibleForAutonomousActions:z.literal(false),
      trainSamples:z.number().int().nonnegative(),
      holdoutSamples:z.number().int().nonnegative(),
      candidates:z.array(z.object({name:z.string(),metric:z.enum(["brier","wape","mae_days"]),score:z.number().nullable()})),
      baselineScore:z.number().nullable(),selectedScore:z.number().nullable(),
      forecast:z.number().nullable(),forecastMonth:z.string().nullable().optional(),reason:z.string(),
    }),
    suppliers:z.object({
      status:z.literal("pilot_not_certified"),verifiedProduction:z.literal(false),
      measure:z.literal("days_purchase_order_to_supplier_invoice_not_delivery"),
      events:z.number().int().nonnegative(),eligibleGroups:z.number().int().nonnegative(),
      backtested:z.number().int().nonnegative(),
      results:z.array(z.object({
        agency:z.string(),supplierId:z.string(),supplier:z.string(),documents:z.number().int(),
        status:z.enum(["backtested_pilot","rejected_backtest"]),
        model:z.string(),maeDays:z.number(),baselineMaeDays:z.number(),
        predictedDocumentLagDays:z.number().nullable(),
        evidenceInvoiceIds:z.array(z.string()),
        candidates:z.array(z.object({name:z.string(),metric:z.literal("mae_days"),score:z.number()})),
      })),
      warnings:z.array(z.string()),
    }),
  }).optional(),
  linkedEvidence:z.object({
    source:z.literal("synthetic_linked_erp_history"),status:z.literal("not_certified"),
    scope:z.object({agencies:z.union([z.literal("*"),z.array(z.string())]),from:z.string().nullable(),to:z.string().nullable()}),
    stock:z.object({
      status:z.enum(["no_positions","reconciled","unverified"]),
      sourceAsOf:z.string(),evaluatedAt:z.string(),
      positions:z.number().int().nonnegative(),
      reconciledPositions:z.number().int().nonnegative(),
      historicalEligible:z.number().int().nonnegative(),
      movementRows:z.number().int().nonnegative(),
      inflowUnits:z.number(),outflowUnits:z.number(),
      mismatches:z.array(z.object({
        agency:z.string(),sku:z.string(),openingDate:z.string().nullable(),
        movementCount:z.number().int(),stockNow:z.number(),
        stockLedgerNow:z.number().nullable(),historicalAtEnd:z.number().nullable(),
        reconciled:z.boolean(),
      })),
      historicalExamples:z.array(z.object({
        agency:z.string(),sku:z.string(),openingDate:z.string().nullable(),
        movementCount:z.number().int(),stockNow:z.number(),
        stockLedgerNow:z.number().nullable(),historicalAtEnd:z.number().nullable(),
        reconciled:z.boolean(),
      })),
    }),
    procurement:z.object({
      status:z.enum(["linked_invoices_not_receipts","no_order_lines"]),
      orderLines:z.number().int(),orders:z.number().int(),invoiceDocuments:z.number().int(),
      incompleteLines:z.number().int(),overInvoicedLines:z.number().int(),
      supplierExamples:z.array(z.object({
        agency:z.string(),supplierId:z.string(),supplier:z.string(),
        documentedOrders:z.number().int(),orderedUnits:z.number(),invoicedUnits:z.number(),
        documentaryFillPercent:z.number().nullable(),invoiceIds:z.array(z.string()),
      })),
      evidenceSample:z.array(z.object({
        agency:z.string(),orderId:z.string(),orderLineId:z.string(),sku:z.string(),
        supplierId:z.string(),invoiceIds:z.array(z.string()),
      })),
    }),
    customers:z.object({
      status:z.enum(["crm_master_data","no_customer_master"]),
      masterProfiles:z.number().int(),profilesWithOpenReceivables:z.number().int(),
      segments:z.array(z.object({
        agency:z.string(),segment:z.string(),clients:z.number().int(),
        creditLimitsTnd:z.number(),outstandingTnd:z.number(),
      })),
      warning:z.string(),
    }),
    warnings:z.array(z.string()),
  }).optional(),
  inventory:z.object({
    status:z.enum(["observed_current_snapshot","not_available"]),
    periodApplicable:z.boolean(),
    positions:z.number().int().nonnegative(),
    positionsWithThreshold:z.number().int().nonnegative(),
    belowReorder:z.number().int().nonnegative(),
    topBelow:z.array(z.object({
      reference:z.string(),agency:z.string(),quantity:z.number(),reorderPoint:z.number(),
    })),
  }),
  cash:z.object({
    status:z.enum(["observed_receivables","not_available"]),asOf:z.string(),
    basis:z.literal("outstanding_for_invoices_issued_in_selected_period"),
    outstandingTnd:z.number(),overdueTnd:z.number(),
    buckets:z.array(z.object({
      key:z.string(),label:z.string(),amountTnd:z.number(),documents:z.number().int().nonnegative(),
    })),
  }),
  scenarios:z.object({
    status:z.enum(["hypotheses","not_available"]),
    basisRevenueTnd:z.number().nullable(),
    options:z.array(z.object({
      id:z.string(),label:z.string(),variationPercent:z.number(),revenueTnd:z.number().nullable(),
      cashImpactTnd:z.null(),netMarginTnd:z.null(),feasible:z.null(),
    })),
    method:z.literal("arithmetic_sensitivity_not_forecast"),
  }),
  warnings:z.array(z.string()),
})
export type GovernedDataScience=z.infer<typeof governedDataScienceSchema>

export const analyticsOverviewSchema = z.object({
  insights: analyticsInsightsSchema.optional(),
  contractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  snapshotId: z.string(),
  generatedAt: z.string().datetime(),
  scope: scopeSchema,
  snapshot: z.object({
    asOf: z.string(),
    source: z.string(),
    sourceKind: z.enum(["sandbox", "erp"]),
    isSynthetic: z.boolean(),
    storage:z.enum(["postgres","local_fixture"]).optional(),
    revision:z.number().int().positive().nullable().optional(),
    demo:z.object({
      mode:z.literal("synthetic_live_demo"),
      lastEvent:z.object({
        id:z.string(),kind:z.enum(["sale","collection","restock","supplier"]),
        agency:z.string(),date:z.string(),reference:z.string(),
        amountTnd:z.number().nullable(),units:z.number().nullable(),
        description:z.string(),erpWrites:z.literal(0),
      }).optional(),
    }).optional(),
  }),
  bi: z.object({ status: z.literal("available"), data: biOverviewSchema }),
  dataScience: z.object({
    status: z.enum(["available","not_configured","forbidden"]),
    modelServingVerified: z.literal(false),
    predictions: z.array(z.never()),
    analysis: governedDataScienceSchema.optional(),
  }),
  agentic: z.object({
    status: platformStatusSchema,
    executionMode: z.literal("read_only"),
    availableAgents: z.array(z.enum(["revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy"])),
  }),
  warnings: z.array(z.string()),
})
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>
