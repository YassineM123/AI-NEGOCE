import crypto from "node:crypto"
import {
  ANALYTICS_CONTRACT_VERSION,
  analyticsOverviewSchema,
  platformContextSchema,
  type AnalyticsOverview,
  type PlatformContext,
} from "../shared/contracts/analytics-platform.js"
import type { AgencyScope, Principal } from "./auth.js"
import type { Organization } from "./store.js"
import type { Dataset } from "./services.js"
import { overview } from "./services.js"
import { hasPermission, permissionsForRole } from "./permissions.js"

export function buildPlatformContext(input: {
  principal: Principal
  sourceAvailable: boolean
}): PlatformContext {
  const permissions = permissionsForRole(input.principal.role).filter(
    (permission) => permission.startsWith("analytics.") || permission === "agentic.read",
  )
  const result = {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    principal: {
      id: input.principal.id,
      organizationId: input.principal.organizationId,
      role: input.principal.role,
      agencies: input.principal.agencies.includes("*") ? "*" as const : [...input.principal.agencies],
    },
    permissions,
    platforms: {
      bi: { status: hasPermission(input.principal.role, "analytics.bi.read") ? input.sourceAvailable ? "available" as const : "unavailable" as const : "forbidden" as const },
      dataScience: {
        status: hasPermission(input.principal.role, "analytics.ds.read") ? "not_configured" as const : "forbidden" as const,
        modelServingVerified: false as const,
      },
      agentic: {
        status: hasPermission(input.principal.role, "agentic.read") ? input.sourceAvailable ? "available" as const : "unavailable" as const : "forbidden" as const,
        executionMode: "read_only" as const,
      },
    },
  }
  return platformContextSchema.parse(result)
}

export function buildAnalyticsOverview(input: {
  principal: Principal
  organization: Organization
  scope: AgencyScope
  from?: string
  to?: string
  dataset: Dataset
  sourceKind: "sandbox" | "erp"
}): AnalyticsOverview {
  const bi = overview({ agencies: input.scope, from: input.from, to: input.to }, input.dataset)
  const snapshotKey = JSON.stringify({
    organizationId: input.principal.organizationId,
    scope: input.scope,
    from: input.from ?? null,
    to: input.to ?? null,
    asOf: bi.metadata.asOf,
  })
  return analyticsOverviewSchema.parse({
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    snapshotId: crypto.createHash("sha256").update(snapshotKey).digest("hex").slice(0, 24),
    generatedAt: new Date().toISOString(),
    scope: input.scope,
    snapshot: {
      asOf: bi.metadata.asOf,
      source: bi.metadata.source,
      sourceKind: input.sourceKind,
      isSynthetic: input.organization.isSynthetic,
    },
    bi: { status: "available", data: bi },
    dataScience: {
      status: "not_configured",
      modelServingVerified: false,
      predictions: [],
    },
    agentic: {
      status: hasPermission(input.principal.role, "agentic.read") ? "available" : "forbidden",
      executionMode: "read_only",
      availableAgents: hasPermission(input.principal.role, "agentic.read")
        ? ["revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy"] : [],
    },
    warnings: ["Aucun service de modeles Data Science n'est configure ou verifie."],
  })
}
