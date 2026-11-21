import type { AgencyScope } from "../auth.js"
import { compareThreeStrategyScenarios } from "./decision-support.js"
import type { Dataset } from "../services.js"
import {
 amount, buildDeepAnalysis, ensureLimit, finding, inventoryInScope, percent,
 receivablesInScope, salesInScope, snapshot, sumMoney, periodContainsSnapshot, type AgentReport, type ReportPeriod,
} from "./common.js"

/**
 * BSA — factual multi-agency comparisons + explicit sensitivity assumptions.
 * Never infer strategy ROI, demand elasticity or guaranteed investment returns.
 */
export function analyzeBusinessStrategy(input: {
 scope: AgencyScope; dataset: Dataset; limit?: number; period?:ReportPeriod
}): AgentReport {
 const limit=input.limit ?? 20
 ensureLimit(limit)
 const snap=snapshot(input.dataset,input.scope,input.period)
 const sales=salesInScope(input.dataset,input.scope,input.period)
 const debt=receivablesInScope(input.dataset,input.scope,input.period)
 const inventory=inventoryInScope(input.dataset,input.scope,input.period)
 const agencyKeys=[...new Set([...sales.map(x=>x.agency),...debt.map(x=>x.agency),...inventory.map(x=>x.agency)])].sort()
 const rows=agencyKeys.map((agency)=>{
   const ss=sales.filter(x=>x.agency===agency)
   const rr=debt.filter(x=>x.agency===agency)
   const ii=inventory.filter(x=>x.agency===agency)
   const total=sumMoney(ss.map(x=>x.revenue))
   const costMissing=ss.some(x=>x.cost===null || x.cost===undefined)
   const costed = costMissing ? null : sumMoney(ss.map(x=>x.cost ?? 0))
   const marginTnd = costed===null ? null : amount(total-costed)
   return {
     agency,
     revenueTnd:total,
     marginTnd,
     marginPercent: marginTnd===null ? null : percent(marginTnd,total),
     missingCostLines:ss.filter(x=>x.cost===null || x.cost===undefined).length,
     receivablesTnd:sumMoney(rr.map(x=>x.outstanding)),
     stockPositions:ii.length,
     lowStockPositions:ii.filter(x=>x.reorderPoint>0&&x.quantity<x.reorderPoint).length,
     invoiceIds:[...new Set(ss.map(x=>x.invoiceId))],
   }
 })
 const totalRevenueTnd=sumMoney(rows.map(x=>x.revenueTnd))
 const ranked=rows.filter(x=>x.revenueTnd>0).sort((a,b)=>b.revenueTnd-a.revenueTnd)
 const findings=ranked.slice(0,limit).map((r,index)=>finding(
   "BSA-"+(index+1).toString().padStart(3,"0"),
   "Performance commerciale : "+r.agency,
   r.missingCostLines>0?"medium":(r.lowStockPositions>0?"medium":"low"),
   "CA HT net "+r.revenueTnd.toFixed(3)+" TND ; part de CA "+
    String(percent(r.revenueTnd,totalRevenueTnd)??"N/D")+" % ; "+
    (r.marginPercent===null?"marge indisponible (coûts manquants)":"marge brute "+r.marginPercent+" %")+
    " ; créances "+r.receivablesTnd.toFixed(3)+" TND. Revoir les contraintes opérationnelles avant arbitrage.",
   "review_strategic_scenario",
   r.invoiceIds.slice(0,20).map((id)=>({type:"invoice" as const,id,agency:r.agency}))
 ))
 const strategic=compareThreeStrategyScenarios(input.dataset,input.scope,input.period)
 const scenarios=[5,10].map((increase)=>({
   id:"REVENUE_UP_"+increase,
   label:"Sensibilité à +"+increase+" % de CA HT",
   assumption:"Hypothèse purement arithmétique, à coûts constants NON validée ; pas un modèle de demande ni un ROI.",
   valueTnd:sales.length ? amount(totalRevenueTnd*increase/100) : null,
 }))
 const metrics={agenciesCompared:agencyKeys.length,revenueTnd:sales.length?totalRevenueTnd:null,
   agenciesWithMarginUnknown:rows.filter(x=>x.missingCostLines>0).length,
   outstandingTnd:debt.length?sumMoney(debt.map(x=>x.outstanding)):null,
   lowStockPositions:periodContainsSnapshot(input.dataset.metadata.asOf,input.period)?inventory.filter(x=>x.reorderPoint>0&&x.quantity<x.reorderPoint).length:null}
 const allScenarios=[...scenarios,...strategic.scenarios.map(s=>({id:"STRATEGY_"+s.id,label:"Sensibilité "+s.title,
   assumption:"Hypothèse purement arithmétique sur le CA, non une prévision; cash/CAPEX non vérifiés.",valueTnd:s.revenueTnd}))]
 return {
   agent:"business_strategy",
   status:agencyKeys.length?"ok":"no_data",
   executionMode:"read_only",
   snapshot:snap,
   metrics,
   findings,
   scenarios:[
     ...scenarios,
     ...strategic.scenarios.map(s=>({
       id:"STRATEGY_"+s.id,label:"Sensibilité "+s.title,
       assumption:"Hypothèse purement arithmétique sur le CA, non une prévision; cash/CAPEX non vérifiés.",
       valueTnd:s.revenueTnd,
     })),
   ],
   deepAnalysis:buildDeepAnalysis({headline:agencyKeys.length?`${agencyKeys.length} agence(s) comparée(s), ${totalRevenueTnd.toFixed(3)} TND de CA`:"Stratégie non analysable",
     explanation:"Rapproche revenu, marge disponible, créances et tension stock afin d'exposer les contraintes avant arbitrage.",metrics,
     metricDefinitions:{agenciesCompared:{label:"Agences comparées",unit:"count",interpretation:"Agences avec données exploitables."},revenueTnd:{label:"CA HT net",unit:"TND",interpretation:"Somme signée des ventes comptabilisées."},outstandingTnd:{label:"Créances ouvertes",unit:"TND",interpretation:"Exposition documentaire du périmètre."},lowStockPositions:{label:"Tensions stock",unit:"count",interpretation:"Positions sous leur seuil ERP."}},findings,scenarios:allScenarios,
     scenarioTradeoffs:["Impact de CA rendu comparable","CAPEX et élasticité non intégrés","À confronter aux contraintes finance et stock"]}),
   decisionSupport:{strategicScenarios:strategic},
   warnings:[
     "Créances à la date d'arrêté sur factures émises dans la période ; stocks seulement si le snapshot date de la période.",
     "Scénarios limités à la sensibilité arithmétique du CA ; aucun coût d'investissement, marché ou ROI fiable n'est disponible.",
     "Les comparaisons de marges sont indisponibles dès que les coûts historiques sont incomplets.",
     "Aucune recommandation d'investissement automatique ou action ERP.",
     ...(agencyKeys.length===0?["Aucune donnée vérifiable dans le périmètre autorisé."]:[]),
   ],
 }
}
