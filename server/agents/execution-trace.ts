import type { AgencyScope } from "../auth.js"
import type { AgentKey } from "./workspace.js"
export type DomainRun = {
  agent:Exclude<AgentKey,"director">
  status:"ok"|"no_data"
  findings:number
  tool:string
}
export type ExecutionTrace={
  version:"agentic-trace-v1"
  planType:"read_only_bounded"
  objective:string
  scope:AgencyScope
  startedAt:string
  finishedAt:string
  durationMs:number
  modelCalls:0
  estimatedModelTokens:0
  erpWrites:0
  maxToolCalls:4
  toolsInvoked:number
  steps:Array<{
    id:string;agent:string;tool:string
    status:"completed"|"no_data"|"waiting_human"
    dependencies:string[]
    findings:number
    explanation:string
  }>
  warnings:string[]
}
const TOOLS:Record<Exclude<AgentKey,"director">,string>={
  revenue_growth:"sales.customer_opportunities",
  financial_strategy:"finance.receivable_diagnosis",
  supply_chain_intelligence:"inventory.reorder_review",
  business_strategy:"strategy.branch_comparison",
}
export function buildExecutionTrace(input:{
  objective:string;scope:AgencyScope;startedAt:string;finishedAt:string;
  runs:DomainRun[];findings:number;warnings?:string[]
}):ExecutionTrace{
  const steps:ExecutionTrace["steps"]=[
    {id:"scope",agent:"backend",tool:"auth.agency_scope",status:"completed",dependencies:[],
      findings:0,explanation:"Identité, rôle, agence et source autorisés côté serveur."},
    ...input.runs.slice(0,4).map((run,index)=>({
      id:"analysis."+String(index+1),agent:run.agent,tool:TOOLS[run.agent],
      status:run.status==="no_data"?"no_data" as const:"completed" as const,
      dependencies:["scope"],findings:run.findings,
      explanation:run.status==="no_data"?
        "Source insuffisante; aucun résultat ne doit être fabriqué.":
        "Moteur métier déterministe exécuté; preuves attachées aux constats.",
    })),
    {id:"review",agent:"human_reviewer",tool:"workflow.approval",
      status:"waiting_human",dependencies:input.runs.slice(0,4).map((_x,i)=>"analysis."+String(i+1)),
      findings:input.findings,explanation:input.findings?
        "La proposition nécessite l'approbation par un autre acteur habilité.":
        "Aucune recommandation exploitable ; aucun ordre envoyé."},
  ]
  return {version:"agentic-trace-v1",planType:"read_only_bounded",objective:input.objective,
    scope:input.scope,startedAt:input.startedAt,finishedAt:input.finishedAt,
    durationMs:Math.max(0,Date.parse(input.finishedAt)-Date.parse(input.startedAt)),
    modelCalls:0,estimatedModelTokens:0,erpWrites:0,maxToolCalls:4,
    toolsInvoked:input.runs.length,steps,warnings:input.warnings?.slice(0,10)??[]}
}
