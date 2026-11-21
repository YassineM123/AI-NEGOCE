/**
 * Strict intent router: factual metrics are served from governed scoped data
 * without consuming LLM tokens. Ambiguous analysis is deferred to the model.
 */
import type {AgencyScope} from "../auth.js"
import type {Dataset} from "../services.js"
import type {AgentKey} from "./workspace.js"
import {buildAnalyticsInsights} from "../analytics-insights.js"
import {analyzeSupplyChain} from "./supply-chain.js"
import {analyzeCustomerConcentration,analyzeReceivablesAging,
  compareThreeStrategyScenarios} from "./decision-support.js"
export type RoutedAnswer={mode:"deterministic";content:string;sources:string[];
  modelCalls:0;tokens:0;rule:string}
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[’']/g,"'").trim()
const money=(n:number)=>n.toLocaleString("fr-FR",{minimumFractionDigits:3,maximumFractionDigits:3})+" TND"
export function routeAnalyticalQuestion(input:{
  agent:AgentKey;question:string;scope:AgencyScope;dataset:Dataset
}):RoutedAnswer|null {
  const q=normalize(input.question)
  if(q.length<8||q.length>280) return null
  if(!/^(quel|quelle|quels|quelles|combien|donne|affiche|montre|indique|total|c'est quoi|liste)/.test(q))
    return null
  if(/\b(pourquoi|comment|faut.il|recommand|optimis|prevoi|prevision|si on|scenario personnalise|strategie pour)\b/.test(q))
    return null
  // An unspecified period or requested breakdown must never be silently
  // answered as an all-time aggregate. Ask for filters in the BI/DS portal.
  if(/\b(20[12][0-9]|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|trimestre|semaine|mois dernier|mois prochain|cette annee|annee derniere|par (mois|produit|famille|client|commercial))\b/.test(q))
    return null
  const dataset=input.dataset,asOf=dataset.metadata.asOf
  const agencyLabels=[...new Set([
    ...dataset.sales.map(r=>r.agency),
    ...dataset.receivables.map(r=>r.agency),
    ...dataset.inventory.map(r=>r.agency),
  ])]
  const mentioned=agencyLabels.filter(a=>q.includes(normalize(a)))
  if(mentioned.length>1)return null
  if(mentioned.length===1&&input.scope!=="*"&&!input.scope.includes(mentioned[0]))return null
  const scope:AgencyScope=mentioned.length===1?[mentioned[0]]:input.scope
  // Multi-domain questions need synthesis; do not return a partial CA figure
  // when the user explicitly requested finance and stock in the same question.
  const domains=[
    /\b(ca|chiffre d'affaires|vente|revenu|clients?)\b/,
    /\b(creance|facture en retard|paiement|tresorerie|cash)\b/,
    /\b(stock|rupture|reapprovisionnement|fournisseur)\b/,
    /\b(strategie|scenario|investissement|capex)\b/,
  ]
  if(domains.filter(r=>r.test(q)).length>1)return null
  const prefix="Source : "+dataset.metadata.source+" ; arrêté : "+asOf+
    " ; montant TND ; périmètre autorisé."
  const answer=(rule:string,description:string,sources:string[]=[]):RoutedAnswer=>({
    mode:"deterministic",content:description+"\n"+prefix,
    sources:[...new Set(sources)].slice(0,10),modelCalls:0,tokens:0,rule,
  })
  if(["director","revenue_growth","business_strategy"].includes(input.agent)){
    if(/\b(ca|chiffre d'affaires|revenus? (total|net)|montant des ventes)\b/.test(q)){
      const x=buildAnalyticsInsights(dataset,{agencies:scope})
      if(x.summary.salesRows===0)return answer("revenue_unavailable",
        "Aucune vente documentée dans ce périmètre : CA non calculable, pas zéro certifié.")
      return answer("revenue_ht_total",
        "Chiffre d'affaires HT net observé : "+money(x.summary.revenue)+
        " ; "+x.summary.documentCount+" document(s) et "+x.summary.customerCount+
        " client(s). Hors données non rapprochées de l'ERP officiel.")
    }
    if(/\b(combien de clients|nombre de clients)\b/.test(q)){
      const x=buildAnalyticsInsights(dataset,{agencies:scope})
      return answer("customer_count","Clients distincts sur ventes postées : "+x.summary.customerCount+".")
    }
    if(/\b(top clients|plus gros clients|principaux clients)\b/.test(q)){
      const x=analyzeCustomerConcentration(dataset,scope)
      return answer("customer_top3",x.top5.slice(0,3).length?
        x.top5.slice(0,3).map((c,i)=>String(i+1)+". "+c.customerId+" ("+c.agency+") : "+money(c.revenueTnd)).join("\n"):
        "Aucun client exploitable dans les ventes du périmètre.")
    }
  }
  if(["director","financial_strategy"].includes(input.agent)){
    if(/\b(creances? echues?|factures? en retard|retard de paiement)\b/.test(q)){
      const x=analyzeReceivablesAging(dataset,scope)
      if(x.status==="not_available")return answer("receivables_unavailable",
        "Les échéances documentaires ne sont pas disponibles : ne pas conclure à zéro impayé.")
      const overdue=x.buckets.slice(1).reduce((n,b)=>n+Math.round(b.amountTnd*1000),0)/1000
      return answer("receivables_overdue","Créances échues constatées : "+money(overdue)+
        " ; encours total documenté : "+money(x.outstandingTnd)+
        ". Vérifier règlements partiels et litiges avant toute relance.")
    }
  }
  if(["director","supply_chain_intelligence"].includes(input.agent)){
    if(/\b(stocks? (sous|en dessous) (le )?seuil|ruptures? de stock|references? sous seuil)\b/.test(q)){
      const r=analyzeSupplyChain({dataset,scope})
      if(r.status==="no_data")return answer("stock_unavailable",
        "Positions de stock indisponibles dans ce périmètre ; aucune absence de rupture déduite.")
      return answer("stock_threshold","Positions de stock sous seuil constatées : "+
        r.metrics.lowStockPositions+" ; positions sans seuil fiable : "+
        r.metrics.positionsWithMissingThreshold+". Aucune commande créée.",
        r.findings.flatMap(f=>f.evidence.map(e=>e.id)))
    }
  }
  if(["director","business_strategy"].includes(input.agent)){
    if(/\b(trois scenarios|3 scenarios|prudent central ambitieux)\b/.test(q)){
      const s=compareThreeStrategyScenarios(dataset,scope)
      return answer("strategy_what_if",s.scenarios.map(x=>x.title+" ("+
        (x.variationPercent>0?"+":"")+x.variationPercent+"% du CA) : "+
        (x.revenueTnd===null?"non disponible":money(x.revenueTnd))).join("\n")+
        "\nHypothèses de sensibilité seulement : marge, cash et faisabilité non vérifiés.")
    }
  }
  return null
}
