/**
 * CDC DIR-04/05/06/09 — conservative cross-specialist decision gates.
 * These are readiness checks, NOT approval or ERP execution authorization.
 * Missing facts remain blockers rather than being coerced to zero.
 */
import type {AgencyScope} from "../auth.js"
import type {Dataset} from "../services.js"
import type {AgentDomain,AgentFinding,ReportPeriod} from "./common.js"
import {inventoryInScope,receivablesInScope,salesInScope} from "./common.js"

export type ReviewedDomain = "revenue_growth"|AgentDomain
export type Readiness = {
  agent:ReviewedDomain;findingId:string;action:string
  status:"blocked_pending_verification"
  blockers:string[];evidenceIds:string[]
  checks:{name:string;verified:boolean;detail:string}[]
  requiresHumanApproval:true;erpWrites:0
}
const scopeAllows=(scope:AgencyScope,agency:string)=>
  scope==="*"||scope.includes(agency)
const checksFor=(agent:ReviewedDomain,hasStock:boolean,hasCosts:boolean,hasReceivables:boolean)=>{
  if(agent==="revenue_growth")return [
    ["client_identity","Identité client ERP et habilitations commerciales à confirmer"],
    ["offer_economics",hasCosts?"Marge observée historique; prix et marge de la proposition non prouvés":"Coûts manquants; marge et prix de la proposition non prouvés"],
    ["offer_stock",hasStock?"Stock courant observé; article et quantité proposés non réservés":"Aucune position de stock pertinente vérifiée"],
    ["consent","Consentement/contact CRM et fréquence des sollicitations non disponibles"],
  ]
  if(agent==="financial_strategy")return [
    ["invoice_settlement",hasReceivables?"Solde documentaire observé; imputation bancaire à rapprocher":"Factures et soldes documentaires manquants"],
    ["disputes","Litiges, avoirs et promesses de paiement non rapprochés"],
    ["bank_liquidity","Solde bancaire et plan de trésorerie non vérifiés"],
  ]
  if(agent==="supply_chain_intelligence")return [
    ["stock_available",hasStock?"Position courante observée; réservations et mouvements non garantis":"Position de stock indisponible"],
    ["supplier_terms","Prix valide, délai, MOQ et confirmation fournisseur non vérifiés"],
    ["procurement_budget","Budget d'achat, transit et approbation non validés"],
  ]
  return [
    ["investment_capacity","CAPEX, BFR et liquidité bancaire non certifiés"],
    ["market_demand","Demande, concurrence et contraintes géographiques non étudiées"],
    ["execution_capacity","Ressources, calendrier, gouvernance et jalons non validés"],
  ]
}
/** Evaluate evidence only in the authorized scope. Never declare an action executable. */
export function assessDecisionReadiness(input:{
  dataset:Dataset;scope:AgencyScope;period?:ReportPeriod
  proposals:Array<{agent:ReviewedDomain}&AgentFinding>
}) {
 const {dataset,scope,period={}}=input
 const sales=salesInScope(dataset,scope,period)
 const inventory=inventoryInScope(dataset,scope,period)
 const debts=receivablesInScope(dataset,scope,period)
 const hasCosts=sales.length>0&&sales.every(x=>x.cost!==null&&x.cost!==undefined)
 const entries:Readiness[]=input.proposals.map(proposal=>{
   const evidence=proposal.evidence.filter(e=>scopeAllows(scope,e.agency))
   const evidenceValid=evidence.length===proposal.evidence.length
   const agencies=new Set(evidence.map(e=>e.agency))
   const hasStock=inventory.some(x=>agencies.size===0||agencies.has(x.agency))
   const hasReceivables=debts.some(x=>agencies.size===0||agencies.has(x.agency))
   const criteria=checksFor(proposal.agent,hasStock,hasCosts,hasReceivables)
   const checks=[
     {name:"evidence_scope",verified:evidenceValid&&evidence.length>0,
       detail:evidenceValid&&evidence.length>0?"Références limitées aux agences autorisées":"Preuve absente ou hors du périmètre autorisé"},
     {name:"snapshot_date",verified:/^\\d{4}-\\d{2}-\\d{2}$/.test(dataset.metadata.asOf),
       detail:"Date d'arrêté de la source; fraîcheur temps réel non garantie"},
     ...criteria.map(([name,detail])=>({name,verified:false,detail})),
     {name:"erp_execution",verified:false,detail:"Connecteur transactionnel et validation LAI non homologués"},
   ]
   return {agent:proposal.agent,findingId:proposal.id,action:proposal.action.type,
     status:"blocked_pending_verification" as const,
     blockers:checks.filter(x=>!x.verified).map(x=>x.name),
     evidenceIds:evidence.map(e=>e.agency+":"+e.type+":"+e.id),
     checks,requiresHumanApproval:true as const,erpWrites:0 as const}
 })
 return {status:"human_validation_required" as const,
   policyVersion:"agentic-gates-v1" as const,
   snapshot:{asOf:dataset.metadata.asOf,revision:dataset.metadata.snapshotRevision??null,
     source:dataset.metadata.source,scope,period},
   assessed:entries.length,readyForErpExecution:0 as const,
   entries,
   warnings:["Aucune décision ne devient exécutable sur la seule base de ce contrôle.",
     "Une approbation humaine ne remplace ni les contrôles métier ni la revalidation du snapshot."]}
}
