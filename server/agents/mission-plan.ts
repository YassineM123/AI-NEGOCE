import type {AgencyScope} from "../auth.js"
import type {Dataset} from "../services.js"
import type {AgentKey} from "./workspace.js"
import {chooseAgents} from "./ai-director.js"
import {inScope,matchesReportPeriod,periodContainsSnapshot,type ReportPeriod} from "./common.js"
export type PlanAgent=Exclude<AgentKey,"director">
export const MISSION_TOOLS:Record<PlanAgent,{
  tool:string;goal:string;required:string[];capabilityIds:string[]
}>={
  revenue_growth:{
    tool:"sales.customer_opportunities",
    goal:"Repérer la croissance, l'érosion et la dormance par client sans prétendre connaître sa probabilité de churn",
    required:["Ventes documentées","ID client stable","Dates des pièces"],
    capabilityIds:["REV-02","REV-03","REV-04","REV-29","REV-39"],
  },
  financial_strategy:{
    tool:"finance.receivable_diagnosis",
    goal:"Vérifier les créances échues, le retard et les documents justificatifs",
    required:["Échéances factures","Encours","Litiges et règlements (si disponibles)"],
    capabilityIds:["FIN-13","FIN-14","FIN-18","FIN-36"],
  },
  supply_chain_intelligence:{
    tool:"inventory.reorder_review",
    goal:"Examiner les positions et seuils, sans simuler des délais fournisseurs inconnus",
    required:["Stock par dépôt","Seuil de commande","Réservations / transit (à confirmer)"],
    capabilityIds:["SCA-01","SCA-07","SCA-10","SCA-20"],
  },
  business_strategy:{
    tool:"strategy.branch_comparison",
    goal:"Comparer les agences et les sensibilités sans inventer les coûts ni le CAPEX",
    required:["Ventes par agence","Coût daté","Objectif et budget approuvés (si disponibles)"],
    capabilityIds:["BSA-01","BSA-05","BSA-11","BSA-63"],
  },
}
export function previewMissionPlan(input:{
  agent:AgentKey;objective:string;scope:AgencyScope;dataset:Dataset;period?:ReportPeriod
}){
  const specialists:PlanAgent[]=input.agent==="director"?
    chooseAgents(input.objective):[input.agent]
  const data=input.dataset
  const scope=input.scope
  const validSales=data.sales.filter(s=>inScope(s.agency,scope)&&
    s.date<=data.metadata.asOf&&matchesReportPeriod(s.date,input.period)&&(s.status??"posted")==="posted")
  const validReceivables=data.receivables.filter(r=>inScope(r.agency,scope)&&r.date<=data.metadata.asOf&&matchesReportPeriod(r.date,input.period))
  const validInventory=data.inventory.filter(r=>inScope(r.agency,scope)&&periodContainsSnapshot(data.metadata.asOf,input.period))
  const rows:Record<PlanAgent,number>={
    revenue_growth:validSales.length,financial_strategy:validReceivables.length,
    supply_chain_intelligence:validInventory.length,
    business_strategy:validSales.length+validReceivables.length+validInventory.length,
  }
  const analyses=specialists.slice(0,4).map((agent,index)=>{
    const tool=MISSION_TOOLS[agent]
    const count=rows[agent]
    return {
      id:"analysis."+(index+1),agent,tool:tool.tool,goal:tool.goal,
      dependencies:["scope"],status:count?"ready" as const:"blocked_data" as const,
      availableRecords:count,required:tool.required,capabilityIds:tool.capabilityIds,
      caveats:[
        ...(agent==="financial_strategy"?
          ["Les positions d'encaissement ne remplacent pas une projection de trésorerie."]:[]),
        ...(agent==="supply_chain_intelligence"?
          ["Réservations, transit, fournisseurs et prix doivent être vérifiés avant achat."]:[]),
        ...(agent==="business_strategy"&&validSales.some(r=>r.cost==null)?
          ["Marge partielle ou inconnue : la simulation de rentabilité est bloquée."]:[]),
      ],
    }
  })
  return {
    planVersion:"director-plan-v1",mode:"bounded_deterministic_read_only",
    objective:input.objective,source:data.metadata.source,asOf:data.metadata.asOf,
    scope,period:{from:input.period?.from??null,to:input.period?.to??null},tools:analyses,toolCallsBudget:4,plannedTools:analyses.length,
    estimatedLlmCalls:0,estimatedLlmTokens:0,erpWriteBudget:0,
    concurrency:"independent_read_only_tools",
    status:analyses.every(x=>x.status==="blocked_data")?"blocked_data" as const:
      analyses.some(x=>x.status==="blocked_data")?"partial" as const:"ready" as const,
    dependencies:{scope:[],review:analyses.map(x=>x.id)},
    gates:{
      humanApprovalRequired:true,erpWritesEnabled:false,
      explanation:"Dossier de proposition uniquement. Aucune mutation ERP ou CRM sans contrat LAI.",
    },
    warnings:[
      "Données filtrées par agence et période sur les ventes et documents de créances.",
      ...(!periodContainsSnapshot(data.metadata.asOf,input.period)?["Stock historique non disponible : snapshot actuel exclu du filtre."]:[]),
      "Préplanification : résultats et impacts inconnus avant exécution.",
      "Budget LLM zéro pour les calculs ; le chat reste une option distincte.",
    ],
  }
}
