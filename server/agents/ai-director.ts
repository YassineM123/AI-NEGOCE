import type { AgencyScope } from "../auth.js"
import type { Dataset } from "../services.js"
import { analyzeRevenueGrowth } from "./revenue-growth.js"
import { analyzeFinancialStrategy } from "./financial-strategy.js"
import { analyzeSupplyChain } from "./supply-chain.js"
import { analyzeBusinessStrategy } from "./business-strategy.js"
import { ensureLimit, snapshot, type AgentDomain, type AgentFinding, type AgentReport, type ReportPeriod } from "./common.js"

export type DirectorAgent = "revenue_growth" | AgentDomain
export const DIRECTOR_AGENTS: DirectorAgent[] = [
  "revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy",
]
type DirectorSection = {
  agent:DirectorAgent
  status:"ok"|"no_data"
  metrics:Record<string,number|null>
  findings:AgentFinding[]
  warnings:string[]
}
export function chooseAgents(objective: string): DirectorAgent[] {
  const q=objective.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
  const selected: DirectorAgent[]=[]
  if (/\b(client|revenu|vente|commercial|croissance|chiffre d.affaire|ca\b|relanc)/.test(q)) selected.push("revenue_growth")
  if (/\b(finance|tresorerie|creance|impaye|cash|recouvrement|paiement|dso)/.test(q)) selected.push("financial_strategy")
  if (/\b(stock|achat|fournisseur|rupture|reapprovisionnement|supply|logistique)/.test(q)) selected.push("supply_chain_intelligence")
  if (/\b(strateg|investissement|compar|agence|scenario|direction|expansion)/.test(q)) selected.push("business_strategy")
  // A quantified revenue growth goal is cross-functional: financing, product
  // availability and strategic capacity must be checked, not silently omitted.
  if (selected.includes("revenue_growth") &&
      /(?:\d+[\s.,]*%|objectif|cible|target)/.test(q) &&
      /(?:mois|an(?:nee)?s?|marge|cash|budget|croissance)/.test(q))
    return [...DIRECTOR_AGENTS]
  return selected.length ? selected : [...DIRECTOR_AGENTS]
}
function revenueSection(data: Dataset, scope: AgencyScope, limit: number,period:ReportPeriod={}): DirectorSection {
  const result=analyzeRevenueGrowth({dataset:data,scope,limit,period})
  return {
    agent:"revenue_growth",
    status:result.status === "ok" ? "ok" : "no_data",
    metrics:{
      customersAnalyzed:result.analysis.customersAnalyzed,
      opportunitiesFound:result.analysis.opportunitiesFound,
    },
    findings:result.opportunities.map((op,index)=>({
      id:"REV-"+(index+1).toString().padStart(3,"0"),
      title:"Client : "+op.customerName+" ("+op.agency+")",
      priority:op.state==="dormant"||op.state==="declining"?"high":"medium",
      explanation:op.reason+" ; score heuristique "+op.priorityScore+"/100",
      evidence:op.evidence.invoiceIds.map((id)=>({type:"invoice" as const,id,agency:op.agency})),
      action:{ ...op.proposedAction, requiresHumanApproval:true as const },
    })),
    warnings:result.warnings,
  }
}
function reportSection(result:AgentReport):DirectorSection {
  return {
    agent:result.agent,
    status:result.status,
    metrics:result.metrics,
    findings:result.findings,
    warnings:result.warnings,
  }
}

/**
 * DIR — bounded, deterministic delegation and evidence assembly.
 * No autonomous LLM, tool recursion, scheduler or mutation is present in this MVP.
 */
export function investigateWithDirector(input: {
  objective:string
  scope:AgencyScope
  dataset:Dataset
  agents?:DirectorAgent[]
  limit?:number
  period?:ReportPeriod
}) {
  const objective=input.objective.trim()
  if (objective.length<5 || objective.length>500) throw new Error("objective length must be from 5 to 500")
  const limit=input.limit ?? 10
  ensureLimit(limit)
  const requested=input.agents ?? chooseAgents(objective)
  const selected=DIRECTOR_AGENTS.filter((x)=>requested.includes(x))
  if (!selected.length) throw new Error("At least one recognized agent is required")
  const snap=snapshot(input.dataset,input.scope,input.period)
  const sections:DirectorSection[]=selected.map((agent)=>{
    switch(agent){
      case "revenue_growth": return revenueSection(input.dataset,input.scope,limit,input.period)
      case "financial_strategy": return reportSection(analyzeFinancialStrategy({dataset:input.dataset,scope:input.scope,limit,period:input.period}))
      case "supply_chain_intelligence": return reportSection(analyzeSupplyChain({dataset:input.dataset,scope:input.scope,limit,period:input.period}))
      case "business_strategy": return reportSection(analyzeBusinessStrategy({dataset:input.dataset,scope:input.scope,limit,period:input.period}))
    }
  })
  const highlights=sections.flatMap((s)=>s.findings.map((f)=>({agent:s.agent,...f})))
    .sort((a,b)=>{
      const priority={high:3,medium:2,low:1}
      return priority[b.priority]-priority[a.priority]||a.id.localeCompare(b.id)
    }).slice(0,limit)
  return {
    director:"ai_director" as const,
    orchestrationMode:"deterministic_read_only" as const,
    status:sections.every(s=>s.status==="no_data")?"no_data" as const:"ok" as const,
    objective,
    snapshot:snap,
    plan:selected.map((agent,index)=>({
      step:index+1, agent, action:"analyze_and_propose" as const, status:"completed_read_only" as const,
    })),
    sections,
    highlights,
    decisionDossier:{
      status:"requires_human_review" as const,
      dataAsOf:snap.asOf,source:snap.source,scope:snap.scope,period:snap.period,
      snapshotRevision:input.dataset.metadata.snapshotRevision??null,
      domainCoverage:sections.map(s=>({
        agent:s.agent,status:s.status,findings:s.findings.length,
        evidenceCount:s.findings.reduce((n,f)=>n+f.evidence.length,0),
        limitations:s.warnings.slice(0,4),
      })),
      proposals:highlights.map(h=>({
        agent:h.agent,action:h.action.type,priority:h.priority,
        title:h.title,evidence:h.evidence,requiresHumanApproval:true as const,
      })),
      safeguards:{
        erpWrites:0 as const,productionModelCertified:false as const,
        bankCashVerified:false as const,expansionRoiVerified:false as const,
        stockAvailabilityVerified:false as const,
      },
      unresolvedDependencies:[
        "Vérifier l'identité et les droits de l'approbateur.",
        "Confirmer les documents ERP, la fraîcheur du snapshot et l'absence de litige.",
        "Rapprocher les budgets, la trésorerie bancaire, les réceptions et la capacité avant décision.",
        ...(sections.some(s=>s.status==="no_data")?["Certaines analyses ne disposent pas d'un historique admissible."]:[]),
      ],
      nextStep:"human_review_and_revalidate_snapshot" as const,
    },
    summary:{
      agentsInvoked:sections.length,
      totalFindings:sections.reduce((sum,s)=>sum+s.findings.length,0),
      requiresHumanReview:highlights.length>0,
      erpWrites:0,
    },
    warnings:[
      "Orchestration déterministe sans autonomie LLM : aucune action ERP/CRM n'est déclenchée.",
      "Les agents retournent des hypothèses, constats et brouillons, pas des validations comptables ou prévisions ML certifiées.",
      ...(sections.some(x=>x.status==="no_data")?["Une ou plusieurs analyses ne disposent pas de données exploitables."]:[]),
    ],
  }
}
