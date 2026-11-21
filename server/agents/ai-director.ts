import type { AgencyScope } from "../auth.js"
import type { Dataset } from "../services.js"
import { analyzeRevenueGrowth } from "./revenue-growth.js"
import { analyzeFinancialStrategy } from "./financial-strategy.js"
import { analyzeSupplyChain } from "./supply-chain.js"
import { analyzeBusinessStrategy } from "./business-strategy.js"
import { ensureLimit, snapshot, type AgentDomain, type AgentFinding, type AgentReport, type DeepAnalysis, type ReportPeriod } from "./common.js"

export type DirectorAgent = "revenue_growth" | AgentDomain
export const DIRECTOR_AGENTS: DirectorAgent[] = [
  "revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy",
]
type DirectorSection = {
  agent:DirectorAgent
  status:"ok"|"no_data"
  metrics:Record<string,number|null>
  findings:AgentFinding[]
  scenarios:AgentReport["scenarios"]
  deepAnalysis:DeepAnalysis
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
    scenarios:result.deepAnalysis.alternatives.map(x=>({id:x.id,label:x.label,assumption:x.assumption,valueTnd:x.estimatedValueTnd})),
    deepAnalysis:result.deepAnalysis,
    warnings:result.warnings,
  }
}
function reportSection(result:AgentReport):DirectorSection {
  return {
    agent:result.agent,
    status:result.status,
    metrics:result.metrics,
    findings:result.findings,
    scenarios:result.scenarios,
    deepAnalysis:result.deepAnalysis,
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
  const scorecard=sections.map((section)=>({agent:section.agent,status:section.status,
    quantifiedInsights:section.deepAnalysis.quantifiedInsights,findings:section.findings.length,
    highPriorityFindings:section.findings.filter(x=>x.priority==="high").length,
    alternatives:section.deepAnalysis.alternatives.length,proposedActions:section.deepAnalysis.proposedActions.length}))
  const active=new Set(sections.filter(x=>x.status==="ok").map(x=>x.agent))
  const synergies:Array<{agents:DirectorAgent[];title:string;explanation:string}>=[]
  if(active.has("revenue_growth")&&active.has("supply_chain_intelligence")) synergies.push({agents:["revenue_growth","supply_chain_intelligence"],title:"Valider la disponibilité avant activation commerciale",explanation:"Rapprocher les opportunités de vente des tensions de stock avant toute sollicitation."})
  if(active.has("financial_strategy")&&active.has("business_strategy")) synergies.push({agents:["financial_strategy","business_strategy"],title:"Financer la stratégie par des hypothèses vérifiables",explanation:"Confronter les scénarios de croissance aux créances et hypothèses de recouvrement."})
  const conflicts:Array<{agents:DirectorAgent[];title:string;explanation:string}>=[]
  if(active.has("revenue_growth")&&active.has("financial_strategy")&&sections.find(x=>x.agent==="financial_strategy")?.findings.length) conflicts.push({agents:["revenue_growth","financial_strategy"],title:"Croissance commerciale versus exposition client",explanation:"Une relance peut accroître l'exposition d'un client en retard ; contrôle crédit requis."})
  const weight={high:3,medium:2,low:1}
  const prioritizedActions=sections.flatMap(section=>section.deepAnalysis.proposedActions.map(action=>({agent:section.agent,...action})))
    .sort((a,b)=>weight[b.priority]-weight[a.priority]||a.id.localeCompare(b.id)).slice(0,limit)
    .map((action,index)=>({rank:index+1,...action}))
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
    comparison:{scorecard,synergies,conflicts,prioritizedActions,
      explanation:"Comparaison par couverture, volume de constats et priorité. Aucun total ne mélange TND, pourcentages et volumes."},
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
