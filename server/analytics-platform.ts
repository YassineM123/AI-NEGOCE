import crypto from "node:crypto"
import { buildAnalyticsInsights } from "./analytics-insights.js"
import { buildDataScienceAnalysis } from "./data-science-platform.js"
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
        status: hasPermission(input.principal.role, "analytics.ds.read") ? input.sourceAvailable ? "available" as const : "unavailable" as const : "forbidden" as const,
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
  const filters={agencies:input.scope,from:input.from,to:input.to}
  const bi=overview(filters,input.dataset)
  const insights=buildAnalyticsInsights(input.dataset,filters)
  const canReadDataScience=hasPermission(input.principal.role,"analytics.ds.read")
  const pseudonymizedExtract = input.dataset.metadata.source.includes("Database/extractions")
  const snapshotKey = JSON.stringify({
    organizationId: input.principal.organizationId,
    scope: input.scope,
    from: input.from ?? null,
    to: input.to ?? null,
    asOf: bi.metadata.asOf,
    source:bi.metadata.source,lastUpdated:bi.metadata.lastUpdated,
    snapshotRevision:input.dataset.metadata.snapshotRevision??null,
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
      storage:input.dataset.metadata.snapshotRevision?"postgres" as const:"local_fixture" as const,
      revision:input.dataset.metadata.snapshotRevision??null,
      ...(input.organization.isSynthetic&&input.dataset.metadata.simulationMode==="synthetic_live_demo"?
        {demo:{
          mode:"synthetic_live_demo" as const,
          ...((input.scope==="*"||input.scope.includes(input.dataset.metadata.demoLastEvent?.agency??""))
            &&input.dataset.metadata.demoLastEvent
            &&(!input.from||input.dataset.metadata.demoLastEvent.date>=input.from)
            &&(!input.to||input.dataset.metadata.demoLastEvent.date<=input.to)
            ?{lastEvent:input.dataset.metadata.demoLastEvent}:{})
        }}:{}),
    },
    bi: { status: "available", data: {
      ...bi,
      // Never leak unscoped event history through the generic BI metadata
      // passthrough when a manager is restricted to one agency.
      metadata:{
        adapter:bi.metadata.adapter,source:bi.metadata.source,
        currency:bi.metadata.currency,asOf:bi.metadata.asOf,
        lastUpdated:bi.metadata.lastUpdated,
        snapshotRevision:bi.metadata.snapshotRevision,
      },
    } },
    insights,
    dataScience: {
      status:canReadDataScience?"available" as const:"forbidden" as const,
      modelServingVerified:false as const,predictions:[],
      ...(canReadDataScience?{analysis:buildDataScienceAnalysis(input.dataset,filters)}:{}),
    },
    agentic: {
      status: hasPermission(input.principal.role, "agentic.read") ? "available" : "forbidden",
      executionMode: "read_only",
      availableAgents: hasPermission(input.principal.role, "agentic.read")
        ? ["revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy"] : [],
    },
    warnings: [
      ...(input.organization.isSynthetic ? [
        "DEMONSTRATION : donnees entierement fictives. Aucune connexion, lecture ou ecriture ERP.",
      ] : []),
      "Analyses Data Science sur dataset commun; modèle CA expérimental et non certifié.",
      ...(pseudonymizedExtract ? [
        "DEMONSTRATION : extraits IAINEG pseudonymises, non rapproches avec les editions officielles.",
        "KPI CA en TND uniquement. EUR/USD exclus des sommes ; aucune conversion FX implicite.",
        "Ventes sans agence, couts non fournis, creances sans echeances detaillees, PMP manquant : ces KPI ne sont pas disponibles.",
      ] : []),
    ],
  })
}
