/**
 * Governed Data Science calculations. Same scoped, period-filtered Dataset as BI;
 * no fake churn probabilities, transactions, or production-certified models.
 */
import type {Dataset,Filters} from "./services.js"
import {filteredSales} from "./services.js"
import {buildAnalyticsInsights} from "./analytics-insights.js"
import {evaluateAgenticForecast} from "./agents/predictive.js"
import {forecastSkuDemand} from "./sku-demand-model.js"
const m=(n:number)=>Math.round(n*1000)
const money=(n:number)=>Math.round(n)/1000
const between=(d:string,f:Filters)=>(!f.from||d>=f.from)&&(!f.to||d<=f.to)
const allowed=(agency:string,f:Filters)=>!f.agencies||f.agencies==="*"||f.agencies.includes(agency)
const age=(a:string,b:string)=>Math.max(0,Math.round(
  (Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000))
export function buildDataScienceAnalysis(data:Dataset,filters:Filters={}){
  const i=buildAnalyticsInsights(data,filters),sales=filteredSales(filters,data)
  const pseudo=data.metadata.source.includes("Database/extractions")
  const clients=new Map<string,{id:string;name:string;last:string;total:number;docs:Set<string>}>()
  for(const s of sales){
    const id=s.customerId??s.customer
    const x=clients.get(id)??{id,name:s.customer,last:s.date,total:0,docs:new Set<string>()}
    x.total+=m(s.revenue);x.docs.add(s.invoiceId)
    if(s.date>x.last)x.last=s.date
    clients.set(id,x)
  }
  const customers=[...clients.values()].map(x=>{
    const days=age(x.last,i.referenceDate)
    return {customerId:x.id,name:x.name,daysSinceLastPurchase:days,
      revenueTnd:money(x.total),documents:x.docs.size,
      segment:days>=90?"inactive_90" as const:days>=30?"watch_30_89" as const:"recent_0_29" as const}
  }).sort((a,b)=>b.revenueTnd-a.revenueTnd||a.customerId.localeCompare(b.customerId))
  const pilot=evaluateAgenticForecast(data,filters)
  const stock=pseudo?[]:data.inventory.filter(s=>allowed(s.agency,filters))
  const stockKnown=stock.filter(s=>Number.isFinite(s.reorderPoint)&&s.reorderPoint>0)
  const under=stockKnown.filter(s=>s.quantity<=s.reorderPoint)
    .sort((a,b)=>(a.quantity-a.reorderPoint)-(b.quantity-b.reorderPoint))
  const invoices=pseudo?[]:data.receivables.filter(r=>
    allowed(r.agency,filters)&&between(r.date,filters)&&r.outstanding>0)
  const buckets=[
    {key:"not_due",label:"Non échues",sum:0,documents:0},
    {key:"late_1_30",label:"1–30 jours",sum:0,documents:0},
    {key:"late_31_60",label:"31–60 jours",sum:0,documents:0},
    {key:"late_61_90",label:"61–90 jours",sum:0,documents:0},
    {key:"late_91_plus",label:"Plus de 90 jours",sum:0,documents:0},
  ]
  for(const r of invoices){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate))continue
    const d=(Date.parse(data.metadata.asOf+"T00:00:00Z")-Date.parse(r.dueDate+"T00:00:00Z"))/86400000
    const idx=d<=0?0:d<=30?1:d<=60?2:d<=90?3:4
    buckets[idx].sum+=m(r.outstanding);buckets[idx].documents++
  }
  const base=sales.reduce((n,r)=>n+m(r.revenue),0)
  return {
    version:"ds-scoped-v1" as const,mode:"governed_read_only" as const,
    source:data.metadata.source,asOf:data.metadata.asOf,referenceDate:i.referenceDate,
    portfolio:{
      status:sales.length?"observed" as const:"no_data" as const,
      customers:customers.length,
      inactive90:customers.filter(c=>c.segment==="inactive_90").length,
      watch30to89:customers.filter(c=>c.segment==="watch_30_89").length,
      recent0to29:customers.filter(c=>c.segment==="recent_0_29").length,
      top:customers.slice(0,10),
      scoring:"observed_recency_not_churn_probability" as const,
    },
    trend:{months:i.months,changePercent:i.summary.monthlyChangePercent,
      classification:i.summary.monthlyChangePercent===null?"not_comparable" as const:
        i.summary.monthlyChangePercent<=-20?"declining" as const:
        i.summary.monthlyChangePercent>=20?"growing" as const:"stable" as const,
      method:"consecutive_closed_months_only" as const},
    skuDemand:forecastSkuDemand(data,filters),
    forecast:{status:pilot.status,modelVersion:pilot.model.version,
      trainedThrough:pilot.model.trainedThrough,trainingMonths:pilot.trainingMonths,
      backtest:pilot.backtest,predictions:pilot.predictions,
      verifiedProduction:false as const,warnings:pilot.warnings},
    inventory:{status:stock.length?"observed_current_snapshot" as const:"not_available" as const,
      periodApplicable:false as const,positions:stock.length,positionsWithThreshold:stockKnown.length,
      belowReorder:under.length,topBelow:under.slice(0,10).map(s=>({
        reference:s.reference,agency:s.agency,quantity:s.quantity,reorderPoint:s.reorderPoint}))},
    cash:{status:invoices.length?"observed_receivables" as const:"not_available" as const,
      asOf:data.metadata.asOf,basis:"outstanding_for_invoices_issued_in_selected_period" as const,
      outstandingTnd:money(invoices.reduce((n,r)=>n+m(r.outstanding),0)),
      overdueTnd:money(buckets.slice(1).reduce((n,b)=>n+b.sum,0)),
      buckets:buckets.map(b=>({key:b.key,label:b.label,
        amountTnd:money(b.sum),documents:b.documents}))},
    scenarios:{status:sales.length?"hypotheses" as const:"not_available" as const,
      basisRevenueTnd:sales.length?money(base):null,
      options:[{id:"prudent",label:"Prudent",percent:-10},
        {id:"central",label:"Central",percent:0},
        {id:"ambitious",label:"Ambitieux",percent:15}].map(x=>({
        id:x.id,label:x.label,variationPercent:x.percent,
        revenueTnd:sales.length?money(Math.round(base*(100+x.percent)/100)):null,
        cashImpactTnd:null as null,netMarginTnd:null as null,feasible:null as null,
      })),method:"arithmetic_sensitivity_not_forecast" as const},
    warnings:[
      "La récence observée n'est pas une probabilité ML de churn.",
      "Prévision SKU calculée uniquement si quantité et historique vérifiables; aucun chiffre de quantité déduit du CA.",
      "Prévision CA ridge expérimentale; sans backtest admissible, aucun chiffre prédit.",
      "Stock = position actuelle, non reconstituée pour une période historique.",
      "Créances = encours arrêté sur factures émises dans la période; pas prévision cash.",
      "Scénarios = sensibilités arithmétiques, sans marge/CAPEX/cash certifiés.",
      ...(pseudo?["Extraits IAINEG : encours détaillés, coûts et stock non validés; analyses correspondantes désactivées."]:[]),
    ],
  }
}
