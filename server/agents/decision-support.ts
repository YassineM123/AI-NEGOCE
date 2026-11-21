/**
 * Explainable zero-LLM specialist calculations. All computations use only
 * the authorized agency scope, known dataset snapshot and observed facts.
 * They are decision aids, NEVER production ML, ERP actions or cash forecasts.
 */
import type {AgencyScope} from "../auth.js"
import type {Dataset} from "../services.js"
import {salesInScope,receivablesInScope,inventoryInScope,reportEnd,type ReportPeriod} from "./common.js"

const money=(v:number)=>Math.round(v*1000)/1000
const sumMilli=(values:number[])=>values.reduce((n,x)=>n+Math.round(x*1000),0)/1000
const daysBetween=(old:string,at:string)=>
  Math.round((Date.parse(at+"T00:00:00Z")-Date.parse(old+"T00:00:00Z"))/86400000)

export function analyzeCustomerConcentration(data:Dataset,scope:AgencyScope,period:ReportPeriod={}){
  const sales=salesInScope(data,scope,period)
  const clients=new Map<string,{id:string;agency:string;revenueMilli:number;invoices:Set<string>;lastPurchase:string|null}>()
  for(const sale of sales){
    const id=sale.customerId || "name:"+sale.agency+":"+sale.customer
    const key=sale.agency+"\u0000"+id
    const item=clients.get(key)??{
      id,agency:sale.agency,revenueMilli:0,invoices:new Set<string>(),lastPurchase:null,
    }
    item.revenueMilli+=Math.round(sale.revenue*1000)
    item.invoices.add(sale.invoiceId)
    if(sale.revenue>0 && (!item.lastPurchase||sale.date>item.lastPurchase))
      item.lastPurchase=sale.date
    clients.set(key,item)
  }
  const ranked=[...clients.values()].sort((a,b)=>b.revenueMilli-a.revenueMilli)
  const totalMilli=sales.reduce((n,r)=>n+Math.round(r.revenue*1000),0)
  const totalTop5Milli=ranked.slice(0,5).reduce((n,r)=>n+r.revenueMilli,0)
  return {
    metric:"customer_portfolio_concentration_not_churn_ml",
    asOf:data.metadata.asOf,source:data.metadata.source,scope,period,
    customers:clients.size,
    revenueTnd:money(totalMilli/1000),
    top5SharePercent:totalMilli>0?Math.round(totalTop5Milli/totalMilli*10000)/100:null,
    dormant90Observed:ranked.filter(r=>r.lastPurchase!==null&&
      daysBetween(r.lastPurchase,reportEnd(data.metadata.asOf,period))>=90).length,
    top5:ranked.slice(0,5).map(r=>({
      customerId:r.id,agency:r.agency,revenueTnd:money(r.revenueMilli/1000),
      documents:r.invoices.size,daysSinceLastPurchase:r.lastPurchase?
        daysBetween(r.lastPurchase,reportEnd(data.metadata.asOf,period)):null,
    })),
    warnings:["Récence constatée, pas probabilité calibrée de churn.",
      "Les clients sans identifiant ERP stable sont isolés par libellé et agence."],
  }
}
export function analyzeReceivablesAging(data:Dataset,scope:AgencyScope,period:ReportPeriod={}){
  const rows=receivablesInScope(data,scope,period)
  const buckets=[
    {key:"not_due",label:"Non échues",amountMilli:0,documents:0},
    {key:"late_1_30",label:"1–30 jours",amountMilli:0,documents:0},
    {key:"late_31_60",label:"31–60 jours",amountMilli:0,documents:0},
    {key:"late_61_90",label:"61–90 jours",amountMilli:0,documents:0},
    {key:"late_91_plus",label:"Plus de 90 jours",amountMilli:0,documents:0},
  ]
  for(const row of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate))continue
    const diff=daysBetween(row.dueDate,data.metadata.asOf)
    const index=diff<=0?0:diff<=30?1:diff<=60?2:diff<=90?3:4
    buckets[index].amountMilli+=Math.round(row.outstanding*1000)
    buckets[index].documents++
  }
  return {
    asOf:data.metadata.asOf,source:data.metadata.source,scope,period,
    status:rows.length?"observed":"not_available",
    buckets:buckets.map(b=>({
      key:b.key,label:b.label,amountTnd:money(b.amountMilli/1000),documents:b.documents,
    })),
    outstandingTnd:sumMilli(rows.map(r=>r.outstanding)),
    warnings:["Créances documentaires à la date d'arrêté. Ne contient ni litiges, ni paiements partiels ni solde bancaire.",
      "DSO et prévision cash non calculés sans journal de facturation et rapprochement bancaire."],
  }
}
export function proposeTransferCandidates(data:Dataset,scope:AgencyScope,period:ReportPeriod={}){
  const rows=inventoryInScope(data,scope,period).filter(r=>
    r.reference.trim() && Number.isFinite(r.quantity)&&Number.isFinite(r.reorderPoint)&&r.reorderPoint>0)
  // A duplicated SKU/depot position makes allocation ambiguous: exclude that pair.
  const key=(ref:string,agency:string)=>agency+"\u0000"+ref
  const counter=new Map<string,number>()
  for(const x of rows)counter.set(key(x.reference,x.agency),(counter.get(key(x.reference,x.agency))??0)+1)
  const valid=rows.filter(x=>counter.get(key(x.reference,x.agency))===1)
  const shortage=valid.filter(x=>x.quantity<x.reorderPoint)
  const options=[]
  for(const recipient of shortage){
    const possible=valid.filter(x=>x.reference===recipient.reference&&x.agency!==recipient.agency &&
      x.quantity>x.reorderPoint)
      .sort((a,b)=>(b.quantity-b.reorderPoint)-(a.quantity-a.reorderPoint))
    const source=possible[0]
    if(!source)continue
    const missing=Math.max(0,Math.ceil(recipient.reorderPoint-recipient.quantity))
    const surplus=Math.max(0,Math.floor(source.quantity-source.reorderPoint))
    const amount=Math.min(missing,surplus)
    if(amount<=0)continue
    options.push({
      sku:recipient.reference,product:recipient.product,
      fromAgency:source.agency,toAgency:recipient.agency,
      proposedUnits:amount,sourceSurplusUnits:surplus,recipientShortfallUnits:missing,
      costTnd:null as number|null,transitDays:null as number|null,
      status:"candidate_unverified" as const,requiresHumanApproval:true as const,
      evidence:[{reference:recipient.reference,agency:source.agency},
        {reference:recipient.reference,agency:recipient.agency}],
      warnings:["Réservations, transit, WMS, disponibilité temps réel, transport et délais non vérifiés.",
        "Confirmer unité ERP identique et autorisations de transfert avant un brouillon."],
    })
  }
  return {asOf:data.metadata.asOf,source:data.metadata.source,scope,period,
    candidates:options.slice(0,25),
    warnings:["Candidats intra-périmètre uniquement. Aucun transfert physique ou ERP déclenché."]}
}
export function compareThreeStrategyScenarios(data:Dataset,scope:AgencyScope,period:ReportPeriod={}){
  const sales=salesInScope(data,scope,period)
  const baselineTnd=sumMilli(sales.map(s=>s.revenue))
  const options=[
    {id:"PRUDENT",title:"Prudent",variationPercent:-10},
    {id:"CENTRAL",title:"Central",variationPercent:0},
    {id:"AMBITIEUX",title:"Ambitieux",variationPercent:15},
  ].map(x=>({
    ...x,baselineTnd:sales.length?baselineTnd:null,
    revenueTnd:sales.length?money(baselineTnd*(1+x.variationPercent/100)):null,
    extraRevenueTnd:sales.length?money(baselineTnd*x.variationPercent/100):null,
    marginTnd:null,cashImpactTnd:null,capexTnd:null,
    feasible:null as boolean|null,
    status:"hypothesis_only" as const,
  }))
  return {asOf:data.metadata.asOf,source:data.metadata.source,scope,period,
    model:"deterministic_what_if_not_forecast",
    sameAssumptions:true,
    scenarios:options,
    warnings:["Hypothèses +/- de CA, pas trois prévisions de demande certifiées.",
      "Marge, cash, CAPEX et faisabilité inconnus sans les contrats et flux LAI validés."],
  }
}
