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

export const analyticsOverviewSchema = z.object({
  contractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  snapshotId: z.string(),
  generatedAt: z.string().datetime(),
  scope: scopeSchema,
  snapshot: z.object({
    asOf: z.string(),
    source: z.string(),
    sourceKind: z.enum(["sandbox", "erp"]),
    isSynthetic: z.boolean(),
  }),
  bi: z.object({ status: z.literal("available"), data: biOverviewSchema }),
  dataScience: z.object({
    status: z.literal("not_configured"),
    modelServingVerified: z.literal(false),
    predictions: z.array(z.never()),
  }),
  agentic: z.object({
    status: platformStatusSchema,
    executionMode: z.literal("read_only"),
    availableAgents: z.array(z.enum(["revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy"])),
  }),
  warnings: z.array(z.string()),
})
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>
