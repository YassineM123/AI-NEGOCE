import type {AgentKey} from "./data"

type Support=Record<string,unknown>
type Card={
  id:string;title:string;detail:string;amount:string|null;status:string;
  evidence:string[];warning:string
}
const record=(value:unknown):Record<string,unknown>|null=>
  value!==null&&typeof value==="object"&&!Array.isArray(value)?
    value as Record<string,unknown>:null
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[]
const str=(v:unknown,fallback="N/D")=>typeof v==="string"&&v.trim()?v:fallback
const numeric=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null
const money=(v:unknown)=>numeric(v)===null?"N/D":
  (v as number).toLocaleString("fr-FR",{minimumFractionDigits:3,maximumFractionDigits:3})+" TND"
const limited=(v:unknown)=>array(v).slice(0,8).map(x=>str(x)).filter(x=>x!=="N/D")
function planCards(agent:AgentKey,support:Support):{title:string;status:string;items:Card[]}{
 if(agent==="revenue"){
  const result=record(support.accountPlans)??{}
  return {title:"Opportunités commerciales · comparatif de pairs",
    status:str(result.status),
    items:array(result.plans).slice(0,8).flatMap((entry,i)=>{
      const p=record(entry);if(!p)return []
      const candidate=record(array(p.crossSellCandidates)[0])??{}
      return [{id:"REV-"+i,title:str(p.customerName)+" · "+str(p.agency),
        detail:"Catégorie à vérifier : "+str(candidate.family)+" · "+str(candidate.peerCustomers,"0")+" clients pairs observés.",
        amount:money(p.revenueTnd),status:"Brouillon à vérifier",
        evidence:[...limited(p.invoiceIds),...limited(candidate.sampleInvoiceIds)],
        warning:"Compatibilité et consentement commercial non vérifiés."}]
    })}
 }
 if(agent==="finance"){
  const result=record(support.collectionQueue)??{}
  return {title:"Recouvrement · revue de factures documentées",status:str(result.status),
    items:array(result.plans).slice(0,8).flatMap((entry,i)=>{
      const p=record(entry);if(!p)return []
      return [{id:"FIN-"+i,title:str(p.invoiceId)+" · "+str(p.customer),
        detail:"Retard : "+str(p.overdueDays,"0")+" jours · Paiements liés : "+money(p.linkedCollectionsTnd),
        amount:money(p.outstandingTnd),status:str(p.classification),
        evidence:[str(p.invoiceId),...limited(p.linkedPaymentIds)],
        warning:"Litige, avoirs et rapprochement bancaire à confirmer."}]
    })}
 }
 if(agent==="supply"){
  const result=record(support.replenishment)??{}
  return {title:"Réapprovisionnement · demandes d'achat non exécutées",
    status:str(result.status),items:array(result.proposals).slice(0,8).flatMap((entry,i)=>{
     const p=record(entry);if(!p)return []
     return [{id:"SCA-"+i,title:str(p.product)+" · "+str(p.agency),
       detail:"Référence : "+str(p.sku)+" · manque minimal "+str(p.minimumUnits,"0")+" unité(s) · prévision pilote : "+
        (numeric(p.forecastQuantityNextMonth)===null?"N/D":String(p.forecastQuantityNextMonth)),
       amount:money(p.purchaseBudgetEstimateTnd),status:"Brouillon, validation obligatoire",
       evidence:[str(p.sku)],warning:"Seuil indicatif ; MOQ, stock réservé et délai fournisseur non validés."}]
    })}
 }
 if(agent==="strategy"){
  const result=record(support.expansionReadiness)??{}
  return {title:"Expansion · comparaison des agences existantes",
    status:str(result.status),items:array(result.agencies).slice(0,8).flatMap((entry,i)=>{
     const p=record(entry);if(!p)return []
     return [{id:"BSA-"+i,title:str(p.agency),
       detail:"Marge brute : "+money(p.grossMarginTnd)+" · créances : "+money(p.outstandingTnd),
       amount:money(p.revenueTnd),status:"Étude d'implantation non validée",
       evidence:limited(p.documentedInvoices),
       warning:"Marché, CAPEX, charges, capacité et cash réel à vérifier avant décision."}]
    })}
 }
 return {title:"Dossier de décision",status:"not_available",items:[]}
}
export default function SpecialistDecisionSupport({agent,support,source,from,to,snapshotId}:{
  agent:AgentKey;support?:Support;source?:string;from:string;to:string;snapshotId?:string
}){
 if(!support)return null
 const {title,status,items}=planCards(agent,support)
 const exportJson=()=>{
  const content={agent,status,source:source??"N/D",from,to,snapshotId:snapshotId??null,
    mode:"read_only",erpWrites:0,requiresHumanReview:true,
    decisionSupport:support}
  const objectUrl=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:"application/json"}))
  const link=document.createElement("a");link.href=objectUrl
  link.download="ai-negoce-decision-support-"+agent+"-"+(snapshotId??"local")+".json"
  document.body.append(link);link.click();link.remove()
  setTimeout(()=>URL.revokeObjectURL(objectUrl),1500)
 }
 return <section className="specialist-evidence" data-agentic-specialist-plan={agent}>
  <div className="specialist-evidence-head">
   <div><h3>{title}</h3><p>Pièces et provenance · {source??"Source non disponible"} · période {from} → {to}</p></div>
   <div><span>{status}</span><button type="button" onClick={exportJson}>Exporter les preuves · JSON</button></div>
  </div>
  {items.length?items.map(item=><article className="specialist-evidence-item" key={item.id}>
   <div><strong>{item.title}</strong><small>{item.status}</small></div>
   <p>{item.detail}</p>
   {item.amount&&<b>{item.amount}</b>}
   <small>Preuves : {item.evidence.length?item.evidence.join(" · "):"Aucune pièce documentée"}</small>
   <small className="specialist-caveat">{item.warning}</small>
  </article>):<p className="specialist-caveat">Aucun dossier admissible pour ce périmètre. Ne pas interpréter comme absence d'opportunité ou de risque.</p>}
  <p className="specialist-caveat">Calcul déterministe sur snapshot autorisé. Les suggestions restent des brouillons : aucune commande, campagne, relance ni ouverture exécutée dans l'ERP.</p>
 </section>
}
