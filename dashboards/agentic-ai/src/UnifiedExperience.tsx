import type { AnalyticsOverview } from "./api"

type Props={
 overview:AnalyticsOverview|null
 agency:string;from:string;to:string
 connected:boolean;onNavigate:(target:"bi"|"ds"|"agentic")=>void
}
const f3=(v:number|null|undefined)=>v==null?"N/D":v.toLocaleString("fr-FR",{minimumFractionDigits:3,maximumFractionDigits:3})
function download(name:string,mime:string,content:string){
 const url=URL.createObjectURL(new Blob([content],{type:mime}))
 const a=document.createElement("a")
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1500)
}
function csvCell(x:unknown){
 const raw=String(x??"")
 const safe=/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw
 return '"'+safe.replace(/"/g,'""')+'"'
}
export default function UnifiedExperience({overview,agency,from,to,connected,onNavigate}:Props){
 const x=overview
 const insights=x?.insights
 const ds=x?.dataScience.analysis
 const ready=Boolean(connected&&x)
 const months=insights?.months??[]
 const values=months.slice(-12)
 const max=Math.max(1,...values.map(v=>Math.abs(v.revenue)))
 const points=values.map((v,i)=>[25+i*550/Math.max(1,values.length-1),135-(v.revenue/max)*110])
 const poly=points.map(p=>p.join(",")).join(" ")
 const rows=insights?.topCustomers??[]
 const fileBase="ai-negoce-"+(x?.snapshotId??"no-snapshot")
 const report=()=>x?{
  reportType:"unified_analytics_evidence",contractVersion:x.contractVersion,snapshotId:x.snapshotId,
  generatedAt:x.generatedAt,scope:x.scope,filters:x.bi.data.filters,
  provenance:x.snapshot,readOnly:true,erpWrites:0,
  bi:x.bi.data,insights:x.insights??null,dataScience:x.dataScience.analysis??null,
  modelServingVerified:x.dataScience.modelServingVerified,
  note:"Données synthétiques ou non homologuées; aucune décision automatique"
 }:null
 const exportJson=()=>{const r=report();if(r)download(fileBase+".json","application/json;charset=utf-8",JSON.stringify(r,null,2))}
 const exportCsv=()=>{
  if(!x)return
  const header=["snapshotId","agency","from","to","metric","value","unit","source"]
  const metrics=[
   ["revenue",x.bi.data.revenue,"TND"],
   ["receivables",x.bi.data.receivables,"TND"],
   ["grossMargin",x.bi.data.marginCoverage==="none"?"N/D":x.bi.data.grossMargin,"TND"],
   ["customers",insights?.summary.customerCount??"N/D","count"],
   ["skuDemandBacktested",ds?.skuDemand.backtested??"N/D","count"],
  ] as const
  const csv=[header.map(csvCell).join(";"),...metrics.map(([k,v,u])=>
   [x.snapshotId,agency,from,to,k,v,u,x.snapshot.source].map(csvCell).join(";"))].join("\r\n")
  download(fileBase+".csv","text/csv;charset=utf-8","\ufeff"+csv)
 }
 return <section className="ux-panel" aria-label="Pilotage transversal des trois plateformes">
  <div className="ux-head">
   <div><strong>Vue transversale · même source de vérité</strong><p>Navigation, graphiques, preuves et exports synchronisés avec BI, Data Science et Agentic</p></div>
   <span className={"ux-status "+(ready?"ux-ok":"ux-idle")} role="status">
    {ready?(x?.snapshot.isSynthetic?"Sandbox synthétique · lecture seule":"Source non homologuée · lecture seule"):"Source non connectée"}
   </span>
  </div>
  {x?.snapshot.demo&&<div className="ux-live-event" role="status" data-demo-live="true">
    <strong>Simulation d'entreprise active · PostgreSQL révision {x.snapshot.revision??"N/D"}</strong>
    <span>{x.snapshot.demo.lastEvent?
      x.snapshot.demo.lastEvent.date+" · "+x.snapshot.demo.lastEvent.agency+
      " · "+({sale:"Nouvelle vente",collection:"Règlement client",restock:"Réapprovisionnement",supplier:"Facture fournisseur"}[x.snapshot.demo.lastEvent.kind])+
      " · "+x.snapshot.demo.lastEvent.reference:
      "Dernière opération dans une autre agence ou hors périmètre"}</span>
    <small>Les KPI sont recalculés lors de la publication d'un nouveau snapshot (vérification toutes les 30 s, onglet visible). Aucun ERP réel connecté.</small>
   </div>}
  <div className="ux-links" aria-label="Navigation transversale">
   <button onClick={()=>onNavigate("bi")}>BI 360</button>
   <button onClick={()=>onNavigate("ds")}>Data Science</button>
   <button onClick={()=>onNavigate("agentic")}>Missions Agentic</button>
  </div>
  <div className="ux-meta">
   <span><b>Agence :</b> {agency==="all"?"Toutes":agency}</span>
   <span><b>Période :</b> {from} → {to}</span>
   <span><b>Snapshot :</b> {x?.snapshotId??"N/D"}</span>
   <span><b>Révision :</b> {x?.snapshot.revision??"N/D"}</span>
   <span><b>Arrêté :</b> {x?.snapshot.asOf??"N/D"}</span>
  </div>
  {ready&&x?<>
   <div className="ux-kpis">
    <article><small>CA HT · TND</small><strong>{f3(x.bi.data.revenue)}</strong><span>Documents postés, avoirs inclus</span></article>
    <article><small>Créances · TND</small><strong>{insights?.coverage.receivablesAvailable===false?"N/D":f3(x.bi.data.receivables)}</strong><span>Encours à la date d'arrêté</span></article>
    <article><small>Clients distincts</small><strong>{insights?.summary.customerCount??"N/D"}</strong><span>IDs source, agence et période</span></article>
    <article><small>Modèles homologués</small><strong>0</strong><span>Prévisions pilotes uniquement</span></article>
   </div>
   <div className="ux-sections">
    <article className="ux-card"><h3>Évolution du chiffre d'affaires · TND</h3>
     {values.length>1?<svg role="img" aria-label="Courbe du CA mensuel calculée sur le snapshot partagé" viewBox="0 0 600 175" width="100%" height="174" preserveAspectRatio="xMidYMid meet">
      <path d="M25 25H575 M25 80H575 M25 135H575" stroke="#dce7f4" strokeWidth="1" fill="none"/>
      <polyline points={poly} fill="none" stroke="#1466d8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      {points.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#1466d8"><title>{values[i].month+" : "+f3(values[i].revenue)+" TND"}</title></circle>)}
      <text x="25" y="162" fill="#667892" fontSize="12">{values[0].month}</text>
      <text x="575" y="162" textAnchor="end" fill="#667892" fontSize="12">{values.at(-1)?.month}</text>
     </svg>:<p>Historique insuffisant : aucune courbe inventée.</p>}
     <small>Ventes mensuelles observées · clôture et complétude selon le backend</small>
    </article>
    <article className="ux-card"><h3>Preuves et qualité</h3>
     <dl className="ux-evidence">
      <dt>Source</dt><dd>{x.snapshot.source}</dd>
      <dt>Identifiant snapshot</dt><dd>{x.snapshotId}</dd>
      <dt>Coûts manquants</dt><dd>{insights?.coverage.costMissingRows??"N/D"}</dd>
      <dt>Backtest CA</dt><dd>{ds?.forecast.status??"N/D"}</dd>
      <dt>Prévisions SKU admissibles</dt><dd>{ds?.skuDemand.backtested??"N/D"}</dd>
      <dt>Écriture ERP</dt><dd>Aucune</dd>
     </dl>
    </article>
   </div>
   <div className="ux-actions">
    <span>{rows.length} client(s) dans l'extrait de classement · montants TND à trois décimales</span>
    <button onClick={exportCsv}>Exporter KPI · CSV</button>
    <button onClick={exportJson}>Exporter rapport & preuves · JSON</button>
   </div>
  </>:<p className="ux-empty">Connecter le sandbox depuis le Command Center pour afficher les KPI, preuves et exports issus du même snapshot.</p>}
 </section>
}
