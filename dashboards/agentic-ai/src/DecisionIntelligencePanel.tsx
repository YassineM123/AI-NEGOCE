import type {AnalyticsOverview,RevenueResult,SpecialistAgent,SpecialistReport,SharedFilters} from "./api"
import "./DecisionIntelligencePanel.css"

type AgentKey="revenue"|"finance"|"supply"|"strategy"
const catalog:ReadonlyArray<{key:AgentKey;title:string;description:string}>=[
 {key:"revenue",title:"Revenue Growth",description:"Croissance, réactivation, ventes complémentaires"},
 {key:"finance",title:"Financial Strategy",description:"Créances, recouvrement, liquidité"},
 {key:"supply",title:"Supply Chain",description:"Ruptures, réassort, transferts"},
 {key:"strategy",title:"Business Strategy",description:"Comparaison agences, investissement, expansion"},
]
const currency=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?
 "N/D":value.toLocaleString("fr-FR",{minimumFractionDigits:3,maximumFractionDigits:3})+" TND"
const count=(n:number|null|undefined)=>typeof n==="number"?n.toLocaleString("fr-FR"):"N/D"
const at=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:null
export type AgentStatus={key:AgentKey;label:string;status:"ready"|"empty"|"loading"|"error"|"unavailable";findings:number|null;signal:string;detail:string}
export function summarizeAgentCoverage(input:{
 overview:AnalyticsOverview|null;revenue:RevenueResult|null;
 specialists:Partial<Record<SpecialistAgent,SpecialistReport>>;
 errors:Partial<Record<SpecialistAgent,string>>;filters:SharedFilters;connected:boolean
}):AgentStatus[]{
 const {overview,revenue,specialists,errors,filters,connected}=input
 const samePeriod=(period?:{from:string|null;to:string|null})=>
   period?.from===filters.from&&period?.to===filters.to
 const sameSource=(source?:string,asOf?:string,scope?:string[]|"*")=>
   !!overview&&source===overview.snapshot.source&&asOf===overview.snapshot.asOf&&
   JSON.stringify(scope)==JSON.stringify(overview.scope)
 return catalog.map(({key,title})=>{
  if(!connected||!overview)return {key,label:title,status:"unavailable",findings:null,signal:"Source absente",detail:"Connectez la session centrale"}
  if(key==="revenue"){
   if(!revenue)return {key,label:title,status:"loading",findings:null,signal:"Calcul en cours",detail:"Attente du rapport du spécialiste"}
   if(!samePeriod(revenue.snapshot.period)||!sameSource(revenue.snapshot.source,revenue.snapshot.asOf,revenue.snapshot.scope))
     return {key,label:title,status:"error",findings:null,signal:"Snapshot incohérent",detail:"Rapport périmé : actualiser les analyses"}
   return {key,label:title,status:revenue.status==="no_data"?"empty":"ready",
     findings:revenue.analysis.opportunitiesFound,
     signal:count(revenue.analysis.opportunitiesFound)+" opportunités",
     detail:"Priorisation heuristique sur achats documentés, sans garantie de conversion"}
  }
  const report=specialists[key]
  if(errors[key])return {key,label:title,status:"error",findings:null,signal:"API indisponible",detail:errors[key]}
  if(!report)return {key,label:title,status:"loading",findings:null,signal:"Calcul en cours",detail:"Attente du rapport du spécialiste"}
  if(!samePeriod(report.snapshot.period)||!sameSource(report.snapshot.source,report.snapshot.asOf,report.snapshot.scope))
   return {key,label:title,status:"error",findings:null,signal:"Snapshot incohérent",detail:"Rapport périmé : actualiser les analyses"}
  const headline=key==="finance"?
    "Créances échues : "+currency(at(report.metrics.overdueTnd)):
    key==="supply"?"Stocks sous seuil : "+count(report.metrics.lowStockPositions):
    "Agences comparées : "+count(report.metrics.agenciesCompared)
  return {key,label:title,status:report.status==="no_data"?"empty":"ready",
   findings:report.findings.length,signal:headline,
   detail:report.status==="no_data"?"Données insuffisantes : aucune absence de risque inférée":
     report.findings.length+" constat(s) à examiner · décision humaine requise"}
 })
}
export default function DecisionIntelligencePanel({overview,revenue,specialists,errors,filters,connected,onOpenAgent}:{
 overview:AnalyticsOverview|null;revenue:RevenueResult|null
 specialists:Partial<Record<SpecialistAgent,SpecialistReport>>;
 errors:Partial<Record<SpecialistAgent,string>>;filters:SharedFilters;connected:boolean;
 onOpenAgent:(agent:AgentKey)=>void
}){
 const agents=summarizeAgentCoverage({overview,revenue,specialists,errors,filters,connected})
 const covered=overview?.insights?.coverage
 const computed=agents.filter(agent=>agent.status==="ready").length
 const ready=connected&&Boolean(overview)
 const missing: Array<{label:string;available:boolean;why:string}>=[
  {label:"Coûts et marges",available:!!covered&&covered.costMissingRows===0&&covered.costKnownRows>0,
    why:"Coût manquant : ne pas extrapoler la rentabilité"},
  {label:"Lignes articles et paniers",available:covered?.invoiceItemLinksAvailable===true,
    why:"Les liens article-facture ne permettent pas tous les co-achats"},
  {label:"Créances documentées",available:covered?.receivablesAvailable===true,
    why:"Créances absentes : impossible de déduire les règlements"},
  {label:"Valorisation de stock",available:covered?.inventoryValuationAvailable===true,
    why:"Coût ou quantité stock indisponible"},
  {label:"Affectation par agence",available:covered?.agencyAttributionAvailable===true,
    why:"Agences non reliées : analyses inter-sites incomplètes"},
  {label:"Modèles IA de production",available:false,
    why:"Pilotes expérimentaux ; validation et supervision ML manquantes"},
 ]
 return <section className="decision-intel" aria-label="Pilotage des agents sur données BI et Data Science" data-agentic-linked-snapshot={overview?.snapshotId??"unavailable"}>
  <header className="decision-intel-head">
   <div><span className="decision-intel-kicker">CENTRE DÉCISIONNEL · BI + DATA SCIENCE + AGENTIC</span>
    <h2>Analyses reliées aux quatre spécialistes</h2>
    <p>Un périmètre, une période et une seule source de vérité. Les recommandations restent soumises à revue humaine.</p></div>
   <span className={"decision-intel-status "+(ready?"linked":"unlinked")}>{ready?"Snapshot partagé":"Source non connectée"}</span>
  </header>
  <div className="decision-intel-kpis">
   <div><span>CA observé HT</span><strong>{ready?currency(overview?.bi.data.revenue):"N/D"}</strong><small>Source BI</small></div>
   <div><span>Base clients</span><strong>{ready?count(overview?.insights?.summary.customerCount):"N/D"}</strong><small>Clients documentés</small></div>
   <div><span>Spécialistes calculés</span><strong>{ready?computed+" / 4":"N/D"}</strong><small>Snapshot vérifié</small></div>
   <div><span>Prévision IA certifiée</span><strong>Non</strong><small>Pilotes uniquement</small></div>
  </div>
  <p className="decision-intel-source">{
   ready?<>Référence <code>{overview?.snapshotId}</code> · {overview?.snapshot.source} · arrêté {overview?.snapshot.asOf} · agence {filters.agency==="all"?"Toutes":filters.agency} · {filters.from} → {filters.to}</>:
   "Connectez le sandbox pour obtenir les constats des agents issus des données partagées."
  }</p>
  <div className="decision-intel-grid">
   {agents.map(a=><article key={a.key} className="decision-intel-agent" data-linked-agent={a.key} data-agent-state={a.status}>
    <div><span className={"decision-intel-dot "+a.status}/><b>{a.label}</b><span className="decision-intel-findings">{a.findings==null?"—":a.findings+" constats"}</span></div>
    <strong>{a.signal}</strong><p>{a.detail}</p>
    <button type="button" onClick={()=>onOpenAgent(a.key)}>Ouvrir l'agent <span aria-hidden="true">→</span></button>
   </article>)}
  </div>
  <div className="decision-intel-quality">
   <div><h3>Qualité de données pour les décisions</h3>
    <p>Les données manquantes restent signalées, jamais remplacées par des valeurs fictives présentées comme réelles.</p></div>
   <div className="decision-intel-checks">{missing.map(x=><div key={x.label}>
    <span className={ready&&x.available?"ok":"missing"}>{ready&&x.available?"Disponible":"À vérifier"}</span>
    <b>{x.label}</b><small>{ready&&x.available?"Présent dans le snapshot BI":x.why}</small>
   </div>)}</div>
  </div>
  <footer>Démonstration synthétique / lecture seule. Un agent ne peut ni émettre une commande, ni payer, ni contacter un client sans processus externe homologué.</footer>
 </section>
}
